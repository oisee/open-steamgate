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
import * as RIR from "../sqlscript-ir.mjs";
import {lower as lowerRelation} from "../sqlscript-lower.mjs";
import {hostPred as rangeHostPred} from "../ir-ranges.mjs";
import * as WIR from "../ir-writes.mjs";
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
// calculation type p: an exact intermediate value (go/abap packed.go),
// rounded only when it lands in a field; len 16 is the 31 digits a p
// literal may have
const P31 = {k: "p", len: 16, dec: 0, calc: true};
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
  && (a.k !== "ref" || a.name === b.name)
  && (a.k !== "p" || (!!a.calc === !!b.calc && (a.calc || (a.len === b.len && a.dec === b.dec))));
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
  const ddls = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, {withFileTypes: true}).sort((x, y) => x.name.localeCompare(y.name))) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (/\.(abap|xml)$/i.test(e.name)) reg.addFile(new abaplint.MemoryFile(e.name, readFileSync(path, "utf8")));
      // a CDS view's source: its SQL view name, for the table registry
      else if (/\.ddls\.asddls$/i.test(e.name)) ddls.push(readFileSync(path, "utf8"));
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
  program.supplied = suppliedParams(reg, program.wanted);
  PROGRAM = program;
  const ctx0 = {reg, program};
  // the local classes of the owners that have them compiled (LOCAL_CLASSES),
  // named OWNER:LOCAL: wanted before any class compiles, so the owner's
  // CREATE OBJECT ... TYPE lcl_x finds its class
  program.locals = new Map();
  LOCAL_DEFS.clear();
  const localDefs = [];
  for (const obj of reg.getObjects()) {
    if (!(obj instanceof abaplint.Objects.Class) || !wanted.includes(obj.getName().toLowerCase()) || !LOCAL_CLASSES.has(upper(obj.getName()))) continue;
    for (const l of localClasses(reg, obj)) {
      program.locals.set(`${upper(obj.getName())}|${l.local}`, l.name);
      program.wanted.add(l.name);
      LOCAL_DEFS.set(l.name, l.def);
      localDefs.push(l);
    }
  }
  for (const obj of reg.getObjects()) {
    if (obj instanceof abaplint.Objects.Class && wanted.includes(obj.getName().toLowerCase())) program.classes.push(classIr(ctx0, obj));
  }
  for (const l of localDefs) program.classes.push(classIr(ctx0, l));
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
      interfaceAttributes(program, name);
    }
    pending = [...program.interfaces].filter((n) => !program.interfaceMethods.has(n));
  }
  program.rtti = rttiTable(reg, program);
  program.exceptionSupers = exceptionSupers(reg, program);
  program.cdsViews = cdsSqlViews(ddls);
  program.tables = tableRegistry(reg, program);
  return program;
}

/**
 * The table registry (go/abap tables.go, README "The table registry"): every
 * TABL and DDIC view the registry has, in name order, as
 *   {name, view, client, key: [..], columns: [{name, kind, len, dec, key, type}],
 *    row: <the Go struct type, when every column is in the subset> | why}
 * where kind is the type kind letter (C N D T I 8 F P g y X), len the
 * characters of C N X and the bytes of P, and type the column's type in the
 * relational IR (sqlscript-ir.mjs T: C/len for C and N, I, INT8, P/digits/
 * dec, STRING, D, X/len, XSTRING; null where the IR has none). Built from
 * the same DDIC facts the SELECT path reads (dbTable), after the classes, so
 * that the row types it adds change nothing they compiled.
 */
/** CDS name -> SQL view name, read off each DDLS source
 * (`@AbapCatalog.sqlViewName: 'ZV...'` and `define [root] view NAME`); a
 * view entity has no SQL view and is left out */
function cdsSqlViews(sources) {
  const out = {};
  for (const src of sources) {
    const sql = /@AbapCatalog\.sqlViewName\s*:\s*'([^']+)'/i.exec(src)?.[1];
    const cds = /\bdefine\s+(?:root\s+)?view\s+(?!entity\b)([\w\/]+)/i.exec(src)?.[1];
    if (sql && cds) out[upper(cds)] = upper(sql);
  }
  return out;
}

/** the table registry as the column registry of the dynamic Open SQL
 * condition parser: {NAME: {view, client, key, columns: [{name, kind, len,
 * dec, key, type}]}}, JSON as it stands (README "The table registry") */
export function columnRegistry(program) {
  return {
    tables: Object.fromEntries((program.tables ?? []).map((t) => [t.name, {view: t.view, client: t.client, key: t.key,
      ...(t.sqlView ? {sqlView: t.sqlView} : {}), ...(t.cds ? {cds: t.cds} : {}),
      // tools/ir-osql-where.mjs osqlWherePredicate(text, columns) as it is
      columns: whereColumns(t),
      fields: t.columns.map((c) => ({name: c.name, kind: c.kind, len: c.len, dec: c.dec, key: c.key}))}])),
    cdsViews: program.cdsViews ?? {},
  };
}

/** {COL: {type, kind?}}: the columns argument of osqlWherePredicate
 * (tools/ir-osql-where.mjs), NUMC marked; a column with no IR type is left
 * out, as the parser could not compare it anyway */
export function whereColumns(t) {
  return Object.fromEntries(t.columns.filter((c) => c.type !== null).map((c) => [c.name, c.kind === "N" ? {type: c.type, kind: "NUMC"} : {type: c.type}]));
}

export function tableRegistry(reg, program) {
  const out = [];
  const saved = [program.currentClass, program.currentTypes];
  program.currentClass = undefined;
  program.currentTypes = undefined;
  try {
    for (const obj of reg.getObjects()) {
      const view = obj instanceof abaplint.Objects.View;
      if (!(obj instanceof abaplint.Objects.Table) && !view) continue;
      const name = upper(obj.getName());
      let st;
      try { st = obj.parseType(reg); } catch { continue; }
      if (!(st instanceof BasicTypes.StructureType)) continue;
      let key = [];
      try { key = view ? [] : (obj.listKeys?.(reg) ?? []).map(upper); } catch { key = []; }
      const columns = st.getComponents().map((c) => {
        const kind = typeKindOf(c.type);
        const len = ["C", "N", "X"].includes(kind) ? c.type.getLength() : kind === "P" ? c.type.getLength() : 0;
        const dec = kind === "P" ? c.type.getDecimals() : 0;
        const ir = {C: {abap: "C", len}, N: {abap: "C", len}, I: {abap: "I"}, 8: {abap: "INT8"}, P: {abap: "P", len: 2 * len - 1, dec},
          g: {abap: "STRING"}, D: {abap: "D"}, X: {abap: "X", len}, y: {abap: "XSTRING"}}[kind] ?? null;
        return {name: upper(c.name), kind, len, dec, key: key.includes(upper(c.name)), type: ir};
      });
      const entry = {name, view, client: columns.some((c) => c.name === "MANDT"), key, columns};
      // a view over a client-dependent table without MANDT hides the client
      // (dbTable refuses it at build time; a read by name at run time does
      // the same, go/abap selectdyn.go)
      if (view && !entry.client) {
        const hidden = [...new Set((obj.getFields() ?? []).map((f) => upper(f.TABNAME)))].find((b) => {
          try {
            const bt = reg.getObject("TABL", b)?.parseType(reg);
            return bt instanceof BasicTypes.StructureType && bt.getComponents().some((c) => upper(c.name) === "MANDT");
          } catch { return false; }
        });
        if (hidden) entry.hidesClient = hidden;
      }
      // a CDS name and its SQL view (both are views here, gen/cds writes the
      // DDIC view under each name); the client is the SQL view's, which is
      // where MANDT is (open-steamgate #45)
      const sqlView = view ? program.cdsViews?.[name] : undefined;
      if (sqlView && sqlView !== name) entry.sqlView = sqlView;
      const cds = Object.entries(program.cdsViews ?? {}).find(([, v]) => v === name)?.[0];
      if (cds && cds !== name) entry.cds = cds;
      try {
        entry.row = typeOf(st, name, program);
        if (entry.row.k !== "struct") throw new Unsupported(`${name}: not a flat structure`);
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        delete entry.row;
        entry.why = e.message;
      }
      out.push(entry);
    }
  } finally {
    [program.currentClass, program.currentTypes] = saved;
  }
  // the other names of the dictionary: CREATE DATA ... TYPE (name) of one
  // of them is refused by name, an unknown name is CX_SY_CREATE_DATA_ERROR
  program.ddicNames = [...program.rtti.known].filter((n) => !/=>/.test(n) && !out.some((t) => t.name === n)).sort();
  return out.sort((a, b) => a.name.localeCompare(b.name));
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
      // a DDIC view (the SQL views of OSG's CDS entities, gen/cds/*.view.xml)
      // is a structure of its fields too (ultra/sadl: the SADL MPC's entity types)
      if (obj instanceof abaplint.Objects.View) add(n, obj.parseType(reg));
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

/**
 * p IS SUPPLIED: the callee must know whether its caller passed p, so every
 * parameter some implementation asks about gets a hidden SUP_<p> ('X' or ''),
 * filled in at each call. Keyed by the class that declares the method, so a
 * redefinition and the class interface keep one signature.
 */
function suppliedParams(reg, wanted) {
  const out = new Map();
  for (const obj of reg.getObjects()) {
    if (!(obj instanceof abaplint.Objects.Class) || !wanted.has(upper(obj.getName()))) continue;
    const st = obj.getMainABAPFile()?.getStructure();
    for (const m of st?.findAllStructures(Structures.Method) ?? []) {
      const found = [...m.concatTokens().matchAll(/(\w+)\s+IS\s+(?:NOT\s+)?SUPPLIED/gi)].map((x) => upper(x[1]));
      if (found.length === 0) continue;
      const name = upper(m.findFirstExpression(Expressions.MethodName).concatTokens());
      if (name.includes("~")) continue;
      const key = `${declaringClass(reg, upper(obj.getName()), name, "method") ?? upper(obj.getName())}=>${name}`;
      out.set(key, new Set([...(out.get(key) ?? []), ...found]));
    }
  }
  return out;
}

/** the hidden SUP_<p> parameters of a method, after its own */
function withSupplied(program, key, params) {
  const set = program.supplied?.get(key);
  if (!set) return params;
  const hidden = params.filter((p) => set.has(p.name)).map((p) => ({name: `SUP_${p.name}`, dir: "importing", byValue: true, type: C(1), optional: true, suppliedOf: p.name}));
  return [...params, ...hidden];
}

/** the interfaces an interface includes, transitively */
function componentInterfaces(reg, intf, seen = new Set()) {
  for (const c of reg.getObject("INTF", intf)?.getDefinition()?.getImplementing?.() ?? []) {
    const n = upper(c.name);
    if (!seen.has(n)) { seen.add(n); componentInterfaces(reg, n, seen); }
  }
  return [...seen];
}

/*
 * Local classes (a class's locals_imp), compiled only for the owners named
 * here: the ICF shim creates its server object as a local class. Each is
 * compiled as a class named OWNER:LOCAL (no ABAP name can hold the colon, so
 * CREATE OBJECT ... TYPE (name) never reaches one), out of an object that
 * answers what classIr asks of a global class. A local class with a
 * superclass or a constructor of its own is refused: neither is looked up
 * outside the registry yet.
 */
const LOCAL_CLASSES = new Set(["CL_EXPRESS_ICF_SHIM"]);
// the definitions of the local classes compiled, by their compiled name
const LOCAL_DEFS = new Map();

function localClasses(reg, obj) {
  const owner = upper(obj.getName());
  const top = new abaplint.SyntaxLogic(reg, obj).run().spaghetti.getTop();
  const out = [];
  for (const file of obj.getABAPFiles()) {
    if (file === obj.getMainABAPFile()) continue;
    for (const info of file.getInfo().listClassDefinitions()) {
      const local = upper(info.name);
      const def = findScope(top, "class_definition", local)?.findClassDefinition(local);
      if (def === undefined) continue;
      out.push({
        name: `${owner}:${local}`, owner, local, obj, def, file,
        getName: () => `${owner}:${local}`,
        getMainABAPFile: () => file,
        getDefinition: () => def,
      });
    }
  }
  return out;
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
  ["ZCL_OAO_RFC_DESTINATION=>REGISTER_LOCAL", "abap.RegisterLocalDestination"],
  // get_text( ) of an exception without a T100 message or a text id: the
  // fallback text, which A4H gives too (2026-09-23); anything else dumps
  ["CL_MESSAGE_HELPER=>GET_TEXT_FOR_MESSAGE", "Native_GET_TEXT_FOR_MESSAGE"],
  // the ICF entity's text body: UTF-8 both ways, as open-abap-core's
  // CL_ABAP_CONV_IN_CE / _OUT_CE do it (TextDecoder with fatal, so bytes that
  // are not UTF-8 raise CX_SY_CONVERSION_CODEPAGE); those two classes take
  // generic parameters, which the subset has no signature for
  // what the host is: runtime, platform, memory, one "name<TAB>value" line
  // each (go/abap/sysinfo.go; on Node the class's own @KERNEL lines)
  ["ZCL_OSD_SYSINFO=>ENVIRONMENT", {fn: "abap.SysInfoEnv", args: []}],
  ["CL_HTTP_ENTITY=>IF_HTTP_ENTITY~GET_CDATA", {fn: "abap.ICFGetCData", args: ["MV_DATA:xstring"]}],
  ["CL_HTTP_ENTITY=>IF_HTTP_ENTITY~SET_CDATA", {fn: "abap.ICFSetCData", args: ["&MV_DATA:xstring", "DATA:string"]}],
]);

/*
 * The kernel lines of the ICF shim (express-icf-shim's cl_express_icf_shim,
 * WRITE '@KERNEL ...' JavaScript on Node) as host functions of the Go
 * runtime (go/abap/icf.go); the ABAP around them compiles as it is. Keyed
 * by method and the line's text. INPUT.req and INPUT.res are the method's
 * REQ and RES, which the host binds to its exchange (abap.ICFExchange);
 * INPUT.class travels in that exchange too. An argument is a name, a
 * component (LS_FIELD-NAME), "&" before a place the function writes, and
 * ":kind" the type it must have. A line of the shim not listed here stays
 * a stub that dumps, as every other @KERNEL line does.
 *   {fn, args}            one statement
 *   {loop, args, binds}   a JavaScript for (...) { over what fn returns,
 *                         each pair written to the binds; its body is the
 *                         statements up to the line {end}
 *   {bound}               a line of that loop whose work the binds do
 */
const KERNEL = new Map([
  ["CL_EXPRESS_ICF_SHIM=>RUN|lv_classname.set(INPUT.class);", {fn: "abap.ICFClass", args: ["REQ:data", "&LV_CLASSNAME:string"]}],
  ["CL_EXPRESS_ICF_SHIM=>REQUEST|lv_xstr.set(INPUT.req.body.toString(\"hex\").toUpperCase());", {fn: "abap.ICFRequestBody", args: ["REQ:data", "&LV_XSTR:xstring"]}],
  ["CL_EXPRESS_ICF_SHIM=>REQUEST|lv_str.set(INPUT.req.method);", {fn: "abap.ICFRequestMethod", args: ["REQ:data", "&LV_STR:string"]}],
  ["CL_EXPRESS_ICF_SHIM=>REQUEST|for (const h in INPUT.req.headers) {", {loop: "abap.ICFRequestHeaders", args: ["REQ:data"], binds: ["LV_NAME", "LV_VALUE"]}],
  ["CL_EXPRESS_ICF_SHIM=>REQUEST|lv_name.set(h);", {bound: "LV_NAME"}],
  ["CL_EXPRESS_ICF_SHIM=>REQUEST|lv_value.set(INPUT.req.headers[h]);", {bound: "LV_VALUE"}],
  ["CL_EXPRESS_ICF_SHIM=>REQUEST|}", {end: true}],
  ["CL_EXPRESS_ICF_SHIM=>REQUEST|lv_value.set(INPUT.req.url);", {fn: "abap.ICFRequestURL", args: ["REQ:data", "&LV_VALUE:string"]}],
  ["CL_EXPRESS_ICF_SHIM=>REQUEST|lv_value.set(INPUT.req.path);", {fn: "abap.ICFRequestPath", args: ["REQ:data", "&LV_VALUE:string"]}],
  ["CL_EXPRESS_ICF_SHIM=>RESPONSE|INPUT.res.append(ls_field.get().name.get(), ls_field.get().value.get());", {fn: "abap.ICFResponseAppend", args: ["RES:data", "LS_FIELD-NAME:string", "LS_FIELD-VALUE:string"]}],
  ["CL_EXPRESS_ICF_SHIM=>RESPONSE|INPUT.res.status(lv_code.get()).send(Buffer.from(lv_xstr.get(), \"hex\"));", {fn: "abap.ICFResponseSend", args: ["RES:data", "LV_CODE:i", "LV_XSTR:xstring"]}],
]);

/** the line of a WRITE '@KERNEL ...' as the JavaScript it holds, else undefined */
function kernelText(node) {
  if (!(node instanceof Nodes.StatementNode) || !isStmt(node, Statements.Write)) return undefined;
  const m = /^WRITE\s+'@KERNEL(.*)'\s*\.?$/is.exec(node.concatTokens());
  return m === null ? undefined : m[1].replace(/''/g, "'").trim();
}

function kernelOf(node, ctx) {
  const text = kernelText(node);
  return text === undefined ? undefined : KERNEL.get(`${ctx.className}=>${ctx.method}|${text}`);
}

/** the arguments of a host function (see KERNEL), resolved in the method */
function nativeArgs(specs, ctx) {
  return specs.map((spec) => {
    const m = /^(&?)([\w\/~]+)(?:-([\w]+))?:(\w+)$/.exec(spec);
    if (m === null) throw new Error(`host function argument ${spec}`);
    let value = variable(m[2], ctx);
    if (m[3] !== undefined) {
      const f = fieldOf(ctx, value.type, m[3], `${ctx.className}=>${ctx.method}`);
      value = {e: "field", base: value, name: f.name, type: f.type};
    }
    if (value.type.k !== m[4]) throw new Unsupported(`host function argument ${spec} is a ${value.type.k}`);
    return {ref: m[1] === "&", value};
  });
}

/**
 * Function modules whose work is the host's: the kernel services of a
 * system that open-abap-core writes as '@KERNEL' JavaScript, called with
 * CALL FUNCTION '<literal>'. Each maps its formal parameters to the side
 * they are passed from (exporting: the caller's EXPORTING, importing: the
 * caller's IMPORTING, tables) and names the host function, which takes
 * every actual parameter as generic data and raises the module's classic
 * exceptions by name. A parameter the map does not name, a DESTINATION, an
 * IN UPDATE TASK or a name that is not a literal is refused.
 *
 * WWWDATA_IMPORT and SCMS_BINARY_TO_XSTRING are SMW0's (go/abap/w3mi.go),
 * their rules measured on A4H 2026-09-23 (ZCL_GOGEN_T_W3MI in semantics.mjs).
 */
const NATIVE_FM = new Map([
  ["WWWDATA_IMPORT", {fn: "abap.WWWDATA_IMPORT", params: {KEY: "exporting", MIME: "tables"}}],
  ["SCMS_BINARY_TO_XSTRING", {fn: "abap.SCMS_BINARY_TO_XSTRING",
    params: {INPUT_LENGTH: "exporting", FIRST_LINE: "exporting", LAST_LINE: "exporting", BUFFER: "importing", BINARY_TAB: "tables"}}],
]);

/** CALL FUNCTION of a module the host implements (NATIVE_FM) */
function callFunction(node, ctx, text) {
  const nameNode = node.findDirectExpression(Expressions.FunctionName);
  const lit = /^'([^']+)'$/.exec(nameNode?.concatTokens() ?? "");
  if (lit === null) throw new Unsupported(`CALL FUNCTION by a name that is not a literal: ${text}`);
  const name = upper(lit[1]);
  // DESTINATION 'AMDP' (tools/amdp-destination.mjs on Node): SQLScript runs
  // in a HANA, which the Go host has none of. Node without one raises
  // CX_SY_DYN_CALL_ILLEGAL_FUNC from the destination before any parameter
  // is passed, and the ABAP around such a call catches cx_root to say so
  // (ZCL_OSD_AMDP_SBX=>ENGINE answers "none"); the Go host raises the same
  // class at the call. Any other destination stays refused.
  const dest = /\bDESTINATION\s+'([^']*)'/i.exec(text)?.[1];
  if (dest !== undefined && upper(dest) === "AMDP" && !/\b(IN\s+UPDATE\s+TASK|STARTING\s+NEW\s+TASK|IN\s+BACKGROUND)\b/i.test(text)) {
    return {s: "raise_runtime", cls: "CX_SY_DYN_CALL_ILLEGAL_FUNC",
      op: `CALL FUNCTION '${name}' DESTINATION 'AMDP': this host has no database that speaks SQLScript (OSGo runs on SQLite; an AMDP method needs a HANA)`};
  }
  const fm = NATIVE_FM.get(name);
  if (fm === undefined) throw new Unsupported(`CALL FUNCTION '${name}': no host implementation of this function module`);
  if (/\b(DESTINATION|IN\s+UPDATE\s+TASK|STARTING\s+NEW\s+TASK|IN\s+BACKGROUND)\b/i.test(text)) throw new Unsupported(`CALL FUNCTION '${name}' form: ${text}`);
  const fp = node.findDirectExpression(Expressions.FunctionParameters);
  const args = [];
  let exceptions = null;
  const side = (pname, want) => {
    const got = fm.params[pname];
    if (got === undefined) throw new Unsupported(`CALL FUNCTION '${name}': parameter ${pname} is not in the host's signature`);
    if (got !== want) throw new Unsupported(`CALL FUNCTION '${name}': ${pname} passed as ${want}, it is ${got}`);
  };
  if (fp !== undefined) {
    const kids = fp.getChildren();
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (isExpr(k, Expressions.FunctionExporting)) {
        for (const p of k.findDirectExpressions(Expressions.FunctionExportingParameter)) {
          const pname = upper(p.findDirectExpression(Expressions.ParameterName).concatTokens());
          side(pname, "exporting");
          args.push({name: pname, value: convert(source(p.findDirectExpression(Expressions.Source), ctx), {k: "data"})});
        }
      } else if (isExpr(k, Expressions.ParameterListT)) {
        const kw = upper(kids[i - 1]?.concatTokens() ?? "");
        const dir = kw === "IMPORTING" ? "importing" : kw === "TABLES" ? "tables" : null;
        if (dir === null) throw new Unsupported(`CALL FUNCTION '${name}': ${kw} parameters`);
        for (const p of k.findDirectExpressions(Expressions.ParameterT)) {
          const pname = upper(p.findDirectExpression(Expressions.ParameterName).concatTokens());
          side(pname, dir);
          const target = lvalue(p.findDirectExpression(Expressions.Target), ctx);
          if (dir === "tables" && target.type.k !== "table") throw new Unsupported(`CALL FUNCTION '${name}': TABLES ${pname} is a ${target.type.k}`);
          if (target.type.hashed) throw new Unsupported(`CALL FUNCTION '${name}': TABLES ${pname} is a hashed table`);
          args.push({name: pname, value: convert(target, {k: "data"})});
        }
      } else if (isExpr(k, Expressions.ParameterListExceptions)) {
        exceptions = {map: {}, others: 0};
        for (const x of k.findDirectExpressions(Expressions.ParameterException)) {
          const v = x.findDirectExpression(Expressions.Integer);
          if (!v) throw new Unsupported(`EXCEPTIONS with a value that is not a number: ${x.concatTokens()}`);
          const nm = x.findDirectExpression(Expressions.ParameterName);
          if (nm) exceptions.map[upper(nm.concatTokens())] = Number(v.concatTokens());
          else exceptions.others = Number(v.concatTokens());
        }
      } else if (!(k instanceof Nodes.TokenNode)) {
        throw new Unsupported(`CALL FUNCTION '${name}' form: ${k.concatTokens()}`);
      }
    }
  }
  return {s: "call_fm", name, fn: fm.fn, args, exceptions};
}

/**
 * instance methods of the kernel whose ABAP signature is generic (TYPE
 * simple, xsequence), so the subset cannot type them: the host function
 * does the work and receives the object (me) first, and the signature it
 * is called with is written here. A caller whose argument does not fit the
 * written type is refused by the ordinary conversion rules.
 * UTF-8 / UTF-16LE text <-> bytes: cl_abap_conv_out_ce / cl_abap_conv_in_ce.
 */
const NATIVE_ME = new Map([
  ["CL_ABAP_CONV_OUT_CE=>CONVERT", {fn: "Native_CONV_OUT_CONVERT", params: [["DATA", "importing", "string"], ["N", "importing", "i", true], ["BUFFER", "exporting", "xstring"]]}],
  ["CL_ABAP_CONV_IN_CE=>CONVERT", {fn: "Native_CONV_IN_CONVERT", params: [["INPUT", "importing", "xstring"], ["N", "importing", "i", true], ["DATA", "exporting", "string"]]}],
]);
const nativeMeSig = (program, key, name) => {
  const n = NATIVE_ME.get(key);
  const T = {string: S, xstring: XS, i: I};
  const own = n.params.map(([pn, dir, t, optional]) => ({name: pn, dir, byValue: false, type: T[t], optional: optional === true}));
  return {name, static: false, private: false, abstract: false, params: withSupplied(program, key, own), returning: null};
};

/* --------------------------------------------------------------------- types */

function typeOf(t, where, program) {
  // generic data: TYPE any / data / ANY TABLE, and data references. A
  // generic value is a binding to a typed slot (abap.Data in Go)
  if (t instanceof BasicTypes.AnyType || t instanceof BasicTypes.DataType) return {k: "data"};
  if (t instanceof BasicTypes.TableType && (t.getRowType() instanceof BasicTypes.AnyType || t.getRowType() instanceof BasicTypes.DataType)) return {k: "data", table: true};
  if (t instanceof BasicTypes.DataReference) return {k: "dref"};
  // REF TO object: the root of every class, any object fits
  if (t instanceof BasicTypes.GenericObjectReferenceType) return {k: "ref", name: "OBJECT", intf: true};
  // d and t: their characters, initial all zeros
  if (t instanceof BasicTypes.DateType) return {k: "d", len: 8};
  // p: declared, initial, copied and compared with initial only, as its
  // decimal text; any arithmetic or conversion is refused until packed
  // numbers are measured on A4H
  if (t instanceof BasicTypes.PackedType) return {k: "p", len: t.getLength(), dec: t.getDecimals()};
  if (t instanceof BasicTypes.TimeType) return {k: "t", len: 6};
  // n: its digits, initial all zeros; declared, copied and compared with
  // initial only until its conversions are measured
  if (t instanceof BasicTypes.NumericType) return {k: "n", len: t.getLength()};
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
    // ultra/itab: the primary key, for SORT without BY: "default", the
    // component names of a user key, or [] for an empty one
    if (access === "STANDARD") {
      const o = t.getOptions();
      const skey = o.keyType === "DEFAULT" ? "default" : o.keyType === "EMPTY" ? [] : (o.primaryKey?.keyFields ?? []).map(upper);
      return {k: "table", row, skey};
    }
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
  // a local class (localClasses) is read in the scopes of its owner
  const spaghetti = new abaplint.SyntaxLogic(reg, obj.obj ?? obj).run().spaghetti;
  const tree = new Rearranger().run("CLAS", file.getStructure());
  const className = upper(obj.getName());
  const scopeName = obj.local ?? className;
  if (obj.local !== undefined && def.getSuperClass()) throw new Error(`${className}: a local class with a superclass is not compiled (LOCAL_CLASSES)`);

  // attributes and constants live in the class implementation scope
  const implScope = findScope(spaghetti.getTop(), "class_implementation", scopeName);
  const defScope = findScope(spaghetti.getTop(), "class_definition", scopeName);
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
    if (NATIVE_ME.has(where)) { signatures.set(name, nativeMeSig(program, where, name)); return; }
    try {
      const p = m.getParameters();
      const optional = new Set((p.getOptional?.() ?? []).map(upper));
      const param = (x, dir) => ({name: upper(x.getName()), dir, byValue: x.getMeta().includes("pass_by_value"), type: typeOf(x.getType(), where, program),
        default: defaultOf(p, x), defaultOwner: prefix ? prefix.slice(0, -1) : className, defOwner: prefix ? prefix.slice(0, -1) : className, optional: optional.has(upper(x.getName()))});
      const ret = p.getReturning();
      const own = [...p.getImporting().map((x) => param(x, "importing")), ...p.getExporting().map((x) => param(x, "exporting")),
        ...p.getChanging().map((x) => param(x, "changing"))];
      signatures.set(name, {
        name, static: isStatic, private: m.getVisibility?.() === 1, abstract: m.isAbstract?.() ?? false,
        params: prefix ? own : withSupplied(program, `${declaringClass(reg, className, name, "method") ?? className}=>${name}`, own),
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
  // an interface a superclass already implements (itself or through an
  // included one) is a field of the superclass's part of the object: a
  // second copy here would be a second field in Go, shadowing the embedded
  // one, and the value would split in two
  const inherited = new Set(ancestors(reg, className).flatMap((c) => (reg.getObject("CLAS", c)?.getDefinition()?.getImplementing() ?? [])
    .flatMap((i) => [upper(i.name), ...componentInterfaces(reg, upper(i.name))])));
  attributes.push(...implementedAttributes(program, implemented.filter((i) => !inherited.has(i))));
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
  // a local class's methods are the ones of its own CLASS ... IMPLEMENTATION
  const methodNodes = obj.local === undefined ? tree.findAllStructures(Structures.Method)
    : tree.findAllStructures(Structures.ClassImplementation).filter((ci) => upper(ci.findFirstExpression(Expressions.ClassName).concatTokens()) === obj.local)
      .flatMap((ci) => ci.findAllStructures(Structures.Method));
  for (const node of methodNodes) {
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
    if (NATIVE_ME.has(`${className}=>${name}`)) {
      cls.methods.push({...sig, locals: [], fieldSymbols: [], calls: [], body: [{s: "native", fn: NATIVE_ME.get(`${className}=>${name}`).fn, me: true}],
        pos: {file: file.getFilename().split("/").pop(), row: node.getFirstToken().getStart().getRow()}});
      continue;
    }
    if (NATIVE.has(`${className}=>${name}`)) {
      const native = NATIVE.get(`${className}=>${name}`);
      // {fn, args}: the host function takes the places and values named
      // (attributes and parameters, "&" for a place it writes) instead of
      // the parameters in their order
      const st = typeof native === "string" ? {s: "native", fn: native}
        : {s: "native", fn: native.fn, args: nativeArgs(native.args, {program, reg, className, scopeName, method: name, sig, signatures, spaghetti, locals: new Map(), fieldSymbols: new Map()})};
      cls.methods.push({...sig, locals: [], fieldSymbols: [], calls: [], body: [st],
        pos: {file: file.getFilename().split("/").pop(), row: node.getFirstToken().getStart().getRow()}});
      continue;
    }
    try {
      const scope = spaghetti.lookupPosition(node.getFirstToken().getStart(), file.getFilename());
      const ctx = {program, reg, className, scopeName, owner: obj.owner ?? className, method: name, sig, signatures, scope, file, spaghetti, locals: new Map(), temps: 0};
      const known = new Set([...sig.params.map((p) => p.name), sig.returning?.name].filter(Boolean));
      ctx.fieldSymbols = new Map();
      for (const [vname, id] of Object.entries(scope.getData().vars)) {
        if (known.has(vname) || vname === "ME" || vname === "SUPER") continue;
        const t = typeOf(id.getType(), `${className}=>${name} ${vname}`, program);
        // a field symbol points into a row: only rows of structures, whose
        // reference both backends can hold (a pointer, an object)
        if (vname.startsWith("<")) {
          if (t.k !== "struct" && t.k !== "data") throw new Unsupported(`field symbol ${vname} of a ${t.k}`);
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
  const hasCtor = methodNodes.some((n) => upper(n.findFirstExpression(Expressions.MethodName).concatTokens()) === "CONSTRUCTOR");
  if (hasCtor && obj.local !== undefined) throw new Error(`${className}: a local class with a constructor is not compiled (LOCAL_CLASSES)`);
  if (hasCtor && cls.constructor === null) {
    const why = program.skipped.find((x) => x.startsWith(`${className}=>CONSTRUCTOR:`))?.replace(/^[^:]+: /, "") ?? "?";
    cls.ctorBroken = why;
    cls.ctorParams = typed.get("CONSTRUCTOR")?.params ?? [];
    for (const m of cls.methods) cls.stubs.push({...m, reason: `the constructor did not compile: ${why}`});
    cls.methods = [];
  }
  return cls;
}

// the scope of that kind, the one of the class named when a name is given
// (a class with local classes has one class_implementation per class, and
// the locals come first); without a match by name, the first of the kind
function findScope(node, stype, name) {
  if (name !== undefined) {
    const named = findScopeNamed(node, stype, upper(name));
    if (named) return named;
  }
  if (node.getIdentifier().stype === stype) return node;
  for (const c of node.getChildren()) {
    const f = findScope(c, stype);
    if (f) return f;
  }
  return undefined;
}

function findScopeNamed(node, stype, name) {
  if (node.getIdentifier().stype === stype && upper(node.getIdentifier().sname) === name) return node;
  for (const c of node.getChildren()) {
    const f = findScopeNamed(c, stype, name);
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
    // an n component (MSGNO of a T100 key) whose VALUE is exactly its digits:
    // the characters are the value; any other n VALUE is not measured
    const nDigits = (f) => f.type.k === "n" && byName.has(f.name) && new RegExp(`^[0-9]{${f.type.len}}$`).test(unquote(byName.get(f.name)));
    if (fields.length === 0 || fields.some((f) => (!SCALAR.includes(f.type.k) && !nDigits(f)) || typeof byName.get(f.name) === "object")) return undefined;
    program.consts.set(go, {go, type, value: Object.fromEntries(fields.map((f) => [f.name, byName.has(f.name) ? unquote(byName.get(f.name)) : undefined]))});
    return go;
  }
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (!SCALAR.includes(type.k)) return undefined;
  program.consts.set(go, {go, type, value: unquote(value)});
  return go;
}

/* ---------------------------------------------------------------- statements */

// the statements and control structures of a body, Normal and Body unwrapped
const flatChildren = (node) => node.getChildren().flatMap((c) => (c instanceof Nodes.StructureNode && (isStruct(c, Structures.Normal) || isStruct(c, Structures.Body)) ? flatChildren(c) : [c]));

function block(node, ctx) {
  return blockList(flatChildren(node), ctx);
}

function blockList(children, ctx) {
  const out = [];
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    // a host loop (KERNEL): the statements up to its closing line are its body
    const k = kernelOf(child, ctx);
    if (k?.loop !== undefined) {
      const pos = {file: ctx.file.getFilename().split("/").pop(), row: child.getFirstToken().getStart().getRow()};
      const j = children.findIndex((c, x) => x > i && kernelOf(c, ctx)?.end === true);
      const inner = children.slice(i + 1, j);
      const where = `${ctx.className}=>${ctx.method} (${pos.file}:${pos.row})`;
      if (j < 0 || ctx.kernelLoop !== undefined || inner.some((c) => !(c instanceof Nodes.StatementNode) || /^(EXIT|CONTINUE|RETURN|CHECK)\b/i.test(c.concatTokens()))) {
        ctx.program.partial.push(`${where}: a kernel loop without its end, nested, or with control flow`);
        out.push({s: "stub", where, reason: "a kernel loop without its end, nested, or with control flow", pos});
        if (j < 0) break;
        i = j;
        continue;
      }
      try {
        const binds = k.binds.map((b) => variable(b, ctx));
        if (binds.some((b) => b.type.k !== "string")) throw new Unsupported(`kernel loop binds ${k.binds.join(", ")}: not strings`);
        ctx.kernelLoop = k;
        out.push({s: "kernel_loop", fn: k.loop, args: nativeArgs(k.args, ctx), binds, body: blockList(inner, ctx), pos});
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        ctx.program.partial.push(`${where}: ${e.message}`);
        out.push({s: "stub", where, reason: e.message.slice(0, 200), pos});
      } finally {
        ctx.kernelLoop = undefined;
      }
      i = j;
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
 * knows. Exception objects of compiled classes (RAISE EXCEPTION) are taken
 * by the class hierarchy at run time; see tryBlock.
 */
const RUNTIME_CX = ["CX_SY_ZERODIVIDE", "CX_SY_ARITHMETIC_OVERFLOW", "CX_SY_CONVERSION_NO_NUMBER", "CX_SY_CONVERSION_OVERFLOW",
  "CX_SY_ITAB_LINE_NOT_FOUND", "CX_SY_RANGE_OUT_OF_BOUNDS", "CX_SY_ARG_OUT_OF_DOMAIN",
  "CX_SY_CREATE_OBJECT_ERROR", "CX_SY_CREATE_DATA_ERROR", "CX_SY_MOVE_CAST_ERROR", "CX_SY_DYN_CALL_ILLEGAL_CLASS", "CX_SY_DYN_CALL_ILLEGAL_METHOD",
  "CX_SY_DYN_CALL_PARAM_MISSING", "CX_SY_DYN_CALL_PARAM_NOT_FOUND",
  // the string functions (repeat( ) replace( ): a parameter out of range)
  "CX_SY_STRG_PAR_VAL",
  // REPLACE ALL OCCURRENCES OF an empty pattern; open-abap-core has no such
  // class, so its superclass is written down below as A4H defines it
  "CX_SY_REPLACE_INFINITE_LOOP",
  // the ICF entity's get_cdata over bytes that are not UTF-8 (abap.ICFGetCData)
  "CX_SY_CONVERSION_CODEPAGE",
  // Open SQL (go/abap/select.go, dbwrite.go, ranges.go): a database error
  // and INSERT FROM TABLE with a duplicate key; a range value longer than
  // its column; a CP pattern past twice the column (tools/ir-ranges.mjs)
  "CX_SY_OPEN_SQL_DB", "CX_SY_OPEN_SQL_DATA_ERROR", "CX_SY_DYNAMIC_OSQL_SEMANTICS",
  // a dynamic WHERE A4H refused (go/abap osqlwhere.go, tools/ir-osql-where.mjs)
  "CX_SY_DYNAMIC_OSQL_SYNTAX",
  // CALL FUNCTION ... DESTINATION 'AMDP' on a host without HANA (callFunction)
  "CX_SY_DYN_CALL_ILLEGAL_FUNC"];
// the superclass of a runtime exception the registry does not hold, read
// off A4H (CX_SY_REPLACE_INFINITE_LOOP inheriting from CX_DYNAMIC_CHECK), and
// CX_SY_OPEN_SQL_DATA_ERROR from CX_SY_OPEN_SQL_ERROR (its definition on
// A4H, 2026-09-23)
const RUNTIME_CX_SUPER = {CX_SY_REPLACE_INFINITE_LOOP: "CX_DYNAMIC_CHECK", CX_SY_OPEN_SQL_DATA_ERROR: "CX_SY_OPEN_SQL_ERROR"};

function isSubclass(reg, cls, ancestor) {
  for (let c = cls, guard = 0; c && guard < 20; guard += 1) {
    if (c === ancestor) return true;
    c = reg.getObject("CLAS", c)?.getDefinition()?.getSuperClass()?.toUpperCase() ?? RUNTIME_CX_SUPER[c];
  }
  return false;
}

function leaves(stmts, inLoop = false) {
  for (const st of stmts ?? []) {
    if (st.s === "return") return true;
    if ((st.s === "exit" || st.s === "continue") && !inLoop) return true;
    const loop = st.s === "loop" || st.s === "do" || st.s === "while" || st.s === "select_loop";
    for (const k of ["body", "then", "else"]) if (Array.isArray(st[k]) && leaves(st[k], inLoop || loop)) return true;
    for (const b of st.branches ?? st.cases ?? st.elseifs ?? []) if (leaves(b.body, inLoop || loop)) return true;
    for (const c of st.catches ?? []) if (leaves(c.body, inLoop)) return true;
  }
  return false;
}

function tryBlock(node, ctx) {
  const body = bodyOf(node, ctx);
  const seen = [];
  const catches = node.findDirectStructures(Structures.Catch).map((c) => {
    const st = c.findDirectStatement(Statements.Catch);
    const names = st.findDirectExpressions(Expressions.ClassName).map((n) => upper(n.concatTokens()));
    // a class after a CATCH of its superclass does not activate on a system
    // (A4H 2026-09-23: "a CATCH clause already exists ... uses the superclass")
    const shadow = names.find((n) => seen.some((e) => isSubclass(ctx.reg, n, e)));
    if (shadow) throw new Unsupported(`CATCH ${shadow} after a CATCH of its superclass`);
    seen.push(...names);
    const covers = RUNTIME_CX.filter((cx) => names.some((n) => isSubclass(ctx.reg, cx, n)));
    // exception objects (RAISE EXCEPTION): taken when the raised class is one
    // of the names or inherits from one, decided at run time
    const own = caughtClasses(ctx, names).length > 0 ? names : [];
    // CATCH ... INTO x: when the CATCH covers exceptions the runtime raises,
    // x is an exception value whose one method here is get_text( ) (a raised
    // object's own get_text, else the class and the operation, not A4H's
    // text); when it covers only raised objects, x keeps its declared
    // reference type and receives the object itself
    let into = null;
    let intoKind = null;
    if (/\bINTO\b/i.test(st.concatTokens())) {
      const target = st.findDirectExpression(Expressions.Target);
      const nm = upper((target.findFirstExpression(Expressions.TargetField) ?? target).concatTokens());
      if (!ctx.locals.has(nm)) throw new Unsupported(`CATCH ... INTO ${nm}: not a local`);
      const declared = ctx.locals.get(nm);
      if (covers.length > 0) {
        ctx.locals.set(nm, EXC);
        intoKind = "exc";
      } else {
        if (declared.k !== "ref") throw new Unsupported(`CATCH ... INTO ${nm}: a ${declared.k} (also the INTO of a CATCH of runtime exceptions)`);
        if (!declared.intf && declared.name !== "OBJECT" && !ctx.program.wanted.has(declared.name)) throw new Unsupported(`CATCH ... INTO ${nm}: REF TO ${declared.name}, which is not compiled`);
        intoKind = "ref";
      }
      into = nm;
    }
    return {classes: names, into, intoKind, intoType: into ? ctx.locals.get(into) : null, covers, own, body: bodyOf(c, ctx)};
  });
  // CLEANUP: runs when a class-based exception leaves the TRY body for a
  // handler further out, inner CLEANUPs first, then the handler (A4H
  // 2026-09-23); not for one raised inside a CATCH of the same TRY. For an
  // exception nobody catches no CLEANUP runs: the kernel looks for a handler
  // before it unwinds and dumps at the RAISE when there is none (A4H
  // 2026-09-23, ZCL_GOGEN_T_UNCAUGHT); the emitters ask the session's
  // active CATCHes (abap.Session.Handled)
  const cl = node.findDirectStructure(Structures.Cleanup);
  let cleanup = null;
  if (cl) {
    if (/\bINTO\b/i.test(cl.findDirectStatement(Statements.Cleanup)?.concatTokens() ?? "")) throw new Unsupported("CLEANUP INTO");
    cleanup = bodyOf(cl, ctx);
    if (leaves(cleanup, false)) throw new Unsupported("RETURN, EXIT or CONTINUE out of a CLEANUP");
  }
  return {s: "try", body, catches, cleanup};
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
      // WHEN a OR b OR c: the alternatives after the first sit in Or nodes
      // (only the first was read until 2026-09-23, silently)
      const alts = [...st.findDirectExpressions(Expressions.Source), ...st.findDirectExpressions(Expressions.Or).map((o) => o.findDirectExpression(Expressions.Source))];
      const expected = 1 + st.findDirectExpressions(Expressions.Or).length;
      if (alts.length !== expected || alts.some((x) => !x) || st.getChildren().filter((c) => !isTok(c)).length !== expected) throw new Unsupported(`WHEN form: ${st.concatTokens()}`);
      const values = alts.map((s) => source(s, ctx));
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
  if (isStruct(node, Structures.Select)) return selectLoop(node, ctx);
  if (isStruct(node, Structures.Loop)) {
    const st = node.findDirectStatement(Statements.Loop);
    const text = st.concatTokens();
    if (/\b(REFERENCE|GROUP|USING|CASTING)\b/i.test(text)) throw new Unsupported(`LOOP form: ${text}`);
    const table = sourceOperand(st.findFirstExpression(Expressions.LoopSource).getFirstChild().getFirstChild(), ctx);
    if (table.type.k === "data") {
      // LOOP AT <generic table> ASSIGNING <generic>: row by row, bound
      const nm = /ASSIGNING\s+(<[\w]+>)/i.exec(text)?.[1];
      if (!nm || ctx.fieldSymbols.get(upper(nm))?.k !== "data" || /\b(WHERE|FROM|TO|INTO)\b/i.test(text.replace(/ASSIGNING.*/i, ""))) throw new Unsupported(`LOOP form over a generic table: ${text}`);
      return {s: "loop_data", table, fs: upper(nm), body: bodyOf(node, ctx)};
    }
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
      if (!sameType(into.type, table.type.row)) throw new Unsupported(`LOOP ... INTO a ${into.type.k} over rows of ${table.type.row.k}`);
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
    // ultra/itab: the loop is known to its body, for DELETE itab (the
    // current row) inside it
    // (a shared token object, not the loop itself, so the IR stays a tree)
    const loop = {s: "loop", table, into, fs, where, from: bound("FROM"), to: bound("TO"), rowType: table.type.row, token: {}};
    (ctx.loopStack ??= []).push(loop);
    // critic fix: inside the body the loop's field symbol is freshly
    // assigned on every pass until a DELETE of the current row makes it
    // stale (fsCheck below)
    const fresh = fs ? {name: fs, stale: false} : null;
    if (fresh) (ctx.fsFresh ??= []).push(fresh);
    try { loop.body = bodyOf(node, ctx); } finally { ctx.loopStack.pop(); if (fresh) ctx.fsFresh.pop(); }
    return loop;
  }
  throw new Unsupported(`structure ${node.get().constructor.name}`);
}

/** WHERE comp op value [AND ...] over the rows of a table of structures */
function whereOf(cc, rowType, ctx, text) {
  if (rowType.k !== "struct") throw new Unsupported("WHERE over a table not of structures");
  const where = [];
  for (const k of cc.getChildren()) {
    if (isTok(k, "AND")) continue;
    // ultra/itab: a component of a component (param-shape) is read through
    // the row (fx, over the row placeholder lrow); c IS [NOT] INITIAL
    const kids = isExpr(k, Expressions.ComponentCompare) ? k.getChildren() : [];
    const words = kids.slice(1).map((x) => (x instanceof Nodes.TokenNode ? upper(x.concatTokens()) : null));
    const initial = kids.length >= 3 && words[0] === "IS" && words[words.length - 1] === "INITIAL" && (kids.length === 3 || (kids.length === 4 && words[1] === "NOT"));
    if (!initial && (!isExpr(k, Expressions.ComponentCompare) || kids.length !== 3)) throw new Unsupported(`WHERE form: ${cc.concatTokens()}`);
    const path = kids[0].concatTokens().split("-");
    let fx = null;
    if (path.length > 1 || initial) {
      fx = {e: "lrow", type: rowType};
      for (const part of path) {
        if (fx.type.k !== "struct") throw new Unsupported(`WHERE component ${kids[0].concatTokens()}`);
        const pf = fieldOf(ctx, fx.type, part, text);
        fx = {e: "field", base: fx, name: pf.name, type: pf.type};
      }
    }
    if (initial) {
      where.push({fx, op: kids.length === 4 ? "notinitial" : "initial"});
      continue;
    }
    const [comp, opN, src] = kids;
    const f = fx !== null ? {name: fx.name, type: fx.type} : fieldOf(ctx, rowType, comp.concatTokens(), text);
    const opT = upper(opN.concatTokens());
    const op = OPS[opT] ?? opT;
    if (!["=", "<>", "<", "<=", ">", ">="].includes(op)) throw new Unsupported(`WHERE operator ${op}`);
    const v = source(src, ctx, f.type);
    const calc = numeric(f.type) || numeric(v.type) ? (f.type.k === "f" || v.type.k === "f" ? F : I) : S;
    if (calc !== S && (charlike(f.type) || charlike(v.type))) throw new Unsupported("WHERE comparing characters with a number");
    where.push({name: f.name, ftype: f.type, op, value: convert(v, calc), calc, ...(fx !== null ? {fx} : {})});
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
  if (isStmt(node, Statements.CreateData)) return createDataStatic(node, ctx, text);
  if (isStmt(node, Statements.Assign)) return assignStatement(node, ctx, text);
  // UNASSIGN <fs>: the field symbol is not assigned any more (a later
  // IS ASSIGNED is false, a read of it GETWA_NOT_ASSIGNED)
  if (isStmt(node, Statements.Unassign)) {
    const m = /^UNASSIGN\s+(<[\w\/]+>)\s*\.?$/i.exec(text);
    const name = m ? upper(m[1]) : undefined;
    if (!name || !ctx.fieldSymbols?.has(name)) throw new Unsupported(`statement Unassign: ${text}`);
    return {s: "unassign", fs: {e: "fs", name, type: ctx.fieldSymbols.get(name)}};
  }
  if (isStmt(node, Statements.Select)) return selectStatement(node, ctx, text);
  if (isStmt(node, Statements.Commit) || isStmt(node, Statements.Rollback)) return luwStatement(node, text);
  if (isStmt(node, Statements.InsertDatabase)) return dbWriteStatement("insert", node, ctx, text);
  if (isStmt(node, Statements.UpdateDatabase)) return dbWriteStatement("update", node, ctx, text);
  if (isStmt(node, Statements.ModifyDatabase)) return dbWriteStatement("merge", node, ctx, text);
  if (isStmt(node, Statements.DeleteDatabase)) return dbWriteStatement("delete", node, ctx, text);
  // DELETE dbtab FROM wa parses as DeleteInternal (abaplint cannot tell it
  // from DELETE itab FROM idx without the dictionary); a name that resolves
  // as a variable is the internal table, as ABAP resolves it, even when a
  // TABL of the same name exists
  if (isStmt(node, Statements.DeleteInternal) && /^DELETE\s+\S+\s+FROM\s+/i.test(text)
    && !isVariableName(text.split(/\s+/)[1], ctx)
    && ctx.reg.getObject("TABL", upper(text.split(/\s+/)[1]))) return dbWriteStatement("delete", node, ctx, text);
  // GET REFERENCE OF x INTO r: r is bound to x itself
  if (isStmt(node, Statements.GetReference)) {
    const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (target.type.k !== "dref") throw new Unsupported(`GET REFERENCE INTO a ${target.type.k}`);
    return {s: "get_ref", target, value: convert(source(node.findDirectExpression(Expressions.Source), ctx), {k: "data"})};
  }
  // DESCRIBE FIELD x TYPE k: the type kind (cl_abap_typedescr=>typekind_*)
  if (isStmt(node, Statements.Describe)) {
    if (!/^DESCRIBE\s+FIELD\s+\S+\s+TYPE\s+\S+\s*\.?$/i.test(text)) throw new Unsupported(`DESCRIBE form: ${text}`);
    const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (target.type.k !== "c" && target.type.k !== "string") throw new Unsupported(`DESCRIBE ... TYPE into a ${target.type.k}`);
    return {s: "describe_kind", x: convert(source(node.findDirectExpression(Expressions.Source), ctx), {k: "data"}), target};
  }
  // CONDENSE x [NO-GAPS]
  // SHIFT s RIGHT DELETING TRAILING mask on a string, measured on A4H
  // (ZCL_GOGEN_T_SHIFT, 2026-09-23): the trailing characters that are in the
  // mask go and as many blanks come in on the left, so the length stays; a
  // blank not in the mask stops it. Every other SHIFT form is refused.
  if (isStmt(node, Statements.Shift)) {
    if (!/^SHIFT\s+\S+\s+RIGHT\s+DELETING\s+TRAILING\s/i.test(text)) throw new Unsupported(`statement Shift: ${text}`);
    const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (target.type.k !== "string") throw new Unsupported(`SHIFT RIGHT DELETING TRAILING of a ${target.type.k}`);
    const mask = source(node.findDirectExpression(Expressions.Source), ctx);
    if (mask.type.k !== "c" && mask.type.k !== "string") throw new Unsupported(`SHIFT ... DELETING TRAILING a ${mask.type.k}`);
    return {s: "shift_right_trailing", target, mask: convert(mask, S)};
  }
  if (isStmt(node, Statements.Condense)) {
    const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (target.type.k !== "c" && target.type.k !== "string") throw new Unsupported(`CONDENSE of a ${target.type.k}`);
    return {s: "condense", target, noGaps: /\bNO\s*-\s*GAPS\b/i.test(text)};
  }
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
    // a generic target is a binding: the value is written into its slot
    // (ultra/itab: genericArith reads the target's kind through ctx.genTarget)
    if (target.type.k === "data") {
      ctx.genTarget = target;
      try { return {s: "set_data", target, value: convert(source(src, ctx, target.type), target.type)}; } finally { ctx.genTarget = undefined; }
    }
    // the calculation type of an assignment includes the TARGET
    return {s: "assign", target, value: convert(source(src, ctx, target.type), target.type)};
  }
  // ultra/itab: APPEND LINES OF src [FROM i] [TO j] TO itab (A4H 2026-09-24,
  // ZCL_GOGEN_T_APPL): the rows i..j of src in order, j clamped to lines(src),
  // nothing when i > j or i past the end; FROM or TO below 1 is the
  // uncatchable TABLE_INVALID_INDEX; sy-subrc untouched, sy-tabix
  // lines(itab) afterwards, whatever was appended; each row converted as a
  // move (c into string); src evaluated once, so itab TO itab doubles it
  if (isStmt(node, Statements.Append) && /^APPEND\s+LINES\s+OF\b/i.test(text)) {
    if (/\b(ASSIGNING|REFERENCE|SORTED BY)\b/i.test(text)) throw new Unsupported(`APPEND form: ${text}`);
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (table.type.k !== "table" || table.type.hashed) throw new Unsupported(`APPEND LINES OF into a ${table.type.hashed ? "hashed table" : table.type.k}`);
    const kids = node.getChildren();
    const srcNode = node.findDirectExpression(Expressions.SimpleSource4) ?? node.findDirectExpression(Expressions.Source);
    const src = source(srcNode, ctx);
    if (src.type.k !== "table") throw new Unsupported(`APPEND LINES OF a ${src.type.k}`);
    let from = null;
    let to = null;
    for (let i = 0; i + 1 < kids.length; i += 1) {
      const next = kids[i + 1];
      if (!isExpr(next, Expressions.Source) || next === srcNode) continue;
      if (isTok(kids[i], "FROM")) from = convert(source(next, ctx, I), I);
      else if (isTok(kids[i], "TO")) to = convert(source(next, ctx, I), I);
    }
    const value = convert({e: "lrow", type: src.type.row}, table.type.row);
    return {s: "append_lines", table, src, from, to, value};
  }
  if (isStmt(node, Statements.Append)) {
    if (/\b(LINES OF|INITIAL LINE|ASSIGNING|REFERENCE|SORTED BY)\b/i.test(text)) throw new Unsupported(`APPEND form: ${text}`);
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    // APPEND wa TO <generic table> (a field symbol TYPE STANDARD TABLE, the
    // rows of CREATE DATA ... TYPE STANDARD TABLE OF (name)): a new row, the
    // value moved into it as a move into generic data converts it
    if (table.type.k === "data") {
      const value = node.findDirectExpression(Expressions.SimpleSource4) ?? node.findDirectExpression(Expressions.Source);
      return {s: "append_data", table, value: convert(source(value, ctx), {k: "data"})};
    }
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
    const ss2 = node.findDirectExpression(Expressions.SimpleSource2);
    if (!ss2) throw new Unsupported(`READ TABLE table form: ${text}`);
    const table = sourceOperand(ss2.getFirstChild(), ctx);
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
    } else if (rt && /^TRANSPORTING\s+NO\s+FIELDS$/i.test(rt.concatTokens().trim())) {
      // only sy-subrc and sy-tabix
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
    // a generic table (ultra/sadl): READ TABLE <t> INDEX n ASSIGNING <generic> only
    if (table.type.k === "data" && table.type.table) {
      const fsName = upper(/ASSIGNING\s+(<[\w]+>)/i.exec(text)?.[1] ?? "");
      if (!fsName || ctx.fieldSymbols.get(fsName)?.k !== "data") throw new Unsupported(`READ TABLE form over a generic table: ${text}`);
      return {s: "read_index_data", table, index: convert(source(node.findDirectExpression(Expressions.Source), ctx, I), I), fs: fsName};
    }
    if (table.type.k !== "table") throw new Unsupported(`READ TABLE ... INDEX of a ${table.type.k}`);
    const index = convert(source(node.findDirectExpression(Expressions.Source), ctx, I), I);
    if (/\bASSIGNING\b/i.test(text)) {
      const fsName = upper(/<[\w]+>/.exec(text)?.[0] ?? "");
      if (!ctx.fieldSymbols.has(fsName)) throw new Unsupported(`READ TABLE ASSIGNING ${fsName}`);
      return {s: "read_index", table, index, fs: fsName};
    }
    const into = lvalue(node.findFirstExpression(Expressions.ReadTableTarget).findFirstExpression(Expressions.Target), ctx);
    return {s: "read_index", table, index, into};
  }
  // ultra/itab: SORT itab [ASCENDING|DESCENDING] [STABLE] [BY c [ASC|DESC] ...]
  // (A4H 2026-09-24, ZCL_GOGEN_T_SORTK). The emitters sort stably, which is
  // what STABLE asks and what A4H showed for equal keys without it. Without
  // BY: the primary key, for a table WITH DEFAULT KEY the line itself when it
  // is elementary, else its c and string components (the ones measured; i is
  // left out); the direction after SORT itab is that of every component that
  // names none. AS TEXT (locale collation) is not measured: refused.
  if (isStmt(node, Statements.Sort)) {
    const m = /^SORT\s+(\S+)((?:\s+(?:ASCENDING|DESCENDING|STABLE))*)(?:\s+BY\s+(.*?))?\s*\.?$/i.exec(text);
    if (m === null || /\bAS\s+TEXT\b/i.test(text)) throw new Unsupported(`SORT form: ${text}`);
    const table = lvalue(node.findDirectExpression(Expressions.Target) ?? node.findFirstExpression(Expressions.Target), ctx);
    if (table.type.k !== "table" || table.type.hashed) throw new Unsupported(`SORT of a ${table.type.hashed ? "hashed table" : table.type.k}`);
    const allDesc = /\bDESCENDING\b/i.test(m[2]);
    const row = table.type.row;
    const sortable = (t) => ["i", "int8", "f", "p", "c", "string", "n", "d", "t", "x", "xstring"].includes(t.k);
    const keys = [];
    if (m[3] === undefined) {
      if (row.k !== "struct") {
        if (table.type.skey !== "default" && !(Array.isArray(table.type.skey) && table.type.skey.length === 1 && table.type.skey[0] === "TABLE_LINE")) throw new Unsupported(`SORT without BY of a table whose key is not known here: ${text}`);
        if (!sortable(row)) throw new Unsupported(`SORT of a table of ${row.k}`);
        keys.push({line: true, type: row, desc: allDesc});
      } else if (table.type.skey === "default") {
        for (const f of PROGRAM.structs.get(row.go).fields) {
          if (f.type.k === "c" || f.type.k === "string") keys.push({name: f.name, type: f.type, desc: allDesc});
          else if (!["i", "int8", "f", "p"].includes(f.type.k)) throw new Unsupported(`SORT by the default key of a structure with a ${f.type.k} component: not measured`);
        }
      } else if (Array.isArray(table.type.skey) && table.type.skey.length > 0) {
        for (const k of table.type.skey) {
          const f = fieldOf(ctx, row, k, text);
          if (!sortable(f.type)) throw new Unsupported(`SORT by a ${f.type.k} component`);
          keys.push({name: f.name, type: f.type, desc: allDesc});
        }
      } else {
        throw new Unsupported(`SORT without BY of a table whose key is not known here: ${text}`);
      }
    } else {
      if (/[()]/.test(m[3])) throw new Unsupported(`SORT form: ${text}`);
      const words = m[3].trim().split(/\s+/);
      for (let i = 0; i < words.length; i += 1) {
        let key;
        if (upper(words[i]) === "TABLE_LINE") {
          if (row.k === "struct" || !sortable(row)) throw new Unsupported(`SORT BY table_line of a table of ${row.k}`);
          key = {line: true, type: row};
        } else {
          if (row.k !== "struct") throw new Unsupported("SORT BY a component of a table that is not of structures");
          if (words[i].includes("-")) throw new Unsupported(`SORT BY a nested component: ${text}`);
          const f = fieldOf(ctx, row, words[i], text);
          if (!sortable(f.type)) throw new Unsupported(`SORT by a ${f.type.k} component`);
          key = {name: f.name, type: f.type};
        }
        let desc = allDesc;
        if (/^(ASCENDING|DESCENDING)$/i.test(words[i + 1] ?? "")) { desc = /^DESCENDING$/i.test(words[i + 1]); i += 1; }
        keys.push({...key, desc});
      }
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
  // ultra/itab: DELETE itab, the short form inside LOOP AT itab: the
  // current row goes and the loop goes on with the row after it (A4H
  // ZCL_GOGEN_T_NSCN); only in the innermost loop, over that same table
  if (isStmt(node, Statements.DeleteInternal) && /^DELETE\s+[^\s.]+\s*\.?$/i.test(text)) {
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    const loop = ctx.loopStack?.[ctx.loopStack.length - 1];
    const same = (a, b) => JSON.stringify(a, (k, v) => (k === "type" ? undefined : v)) === JSON.stringify(b, (k, v) => (k === "type" ? undefined : v));
    if (!loop || table.type.k !== "table" || !same(loop.table, table)) throw new Unsupported(`DELETE itab outside a LOOP over it: ${text}`);
    // critic fix: LOOP ... TO n with a deletion was not measured (the TO
    // bound would stay absolute while the index steps back)
    if (loop.to !== null) throw new Unsupported(`DELETE itab inside LOOP ... TO: not measured: ${text}`);
    // critic fix: what <fs> of LOOP ... ASSIGNING <fs> is after its row went
    // was not measured (Go would see the next row, JS the deleted one), so
    // any later use of it in the method is refused (fsCheck)
    if (loop.fs) {
      const fresh = ctx.fsFresh?.findLast((f) => f.name === loop.fs);
      if (fresh) fresh.stale = true;
      (ctx.fsGone ??= new Set()).add(loop.fs);
    }
    return {s: "delete_current", table, token: loop.token};
  }
  if (isStmt(node, Statements.DeleteInternal)) {
    if (!/^DELETE\s+\S+\s+INDEX\s+/i.test(text)) throw new Unsupported(`DELETE form: ${text}`);
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    // a generic table (ultra/sadl): the same rule through its descriptor
    if (table.type.k === "data" && table.type.table) return {s: "delete_index_data", table, index: convert(source(node.findDirectExpressions(Expressions.Source).slice(-1)[0], ctx, I), I)};
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
  if (isStmt(node, Statements.Replace)) return replaceStatement(node, ctx, text);
  if (isStmt(node, Statements.Translate)) {
    const m = /\bTO\s+(UPPER|LOWER)\s+CASE\b/i.exec(text);
    if (m === null) throw new Unsupported(`TRANSLATE form: ${text}`);
    const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (!charlike(target.type)) throw new Unsupported("TRANSLATE of a non-character field");
    return {s: "translate", target, upper: upper(m[1]) === "UPPER"};
  }
  // RAISE EXCEPTION TYPE cls [EXPORTING ...] / RAISE EXCEPTION obj
  if (isStmt(node, Statements.Raise) && /^RAISE\s+(EXCEPTION|RESUMABLE|SHORTDUMP)\b/i.test(text)) return raiseException(node, ctx, text);
  // RAISE name: a classic exception, for the caller's EXCEPTIONS list
  if (isStmt(node, Statements.Raise) && !/^RAISE\s+(EXCEPTION|RESUMABLE)\b/i.test(text)) {
    const n = node.findDirectExpression(Expressions.ExceptionName);
    if (!n) throw new Unsupported(`RAISE form: ${text}`);
    return {s: "raise_classic", name: upper(n.concatTokens()), method: ctx.method.includes("~") ? ctx.method.split("~")[1] : ctx.method};
  }
  // CALL METHOD (class)=>m EXPORTING ...: a static method by class name,
  // through the program's registry of static methods
  if (isStmt(node, Statements.Call) && node.findDirectExpression(Expressions.MethodSource)?.findDirectExpression(Expressions.Dynamic)) {
    const ms = node.findDirectExpression(Expressions.MethodSource);
    const kids = ms.getChildren();
    if (kids.length !== 3 || !isTok(kids[1], "=>") || !isExpr(kids[2], Expressions.AttributeName)) throw new Unsupported(`CALL METHOD form: ${text}`);
    const inner = kids[0].getChildren().filter((c) => !isTok(c));
    if (inner.length !== 1) throw new Unsupported(`CALL METHOD form: ${text}`);
    const cls = convert(sourceOperand(inner[0], ctx), S);
    const body = node.findDirectExpression(Expressions.MethodCallBody);
    const mp = body?.findDirectExpression(Expressions.MethodParameters);
    if (mp && /\b(IMPORTING|CHANGING|RECEIVING|EXCEPTIONS)\b/i.test(mp.concatTokens())) throw new Unsupported(`CALL METHOD by name with ${mp.concatTokens()}`);
    if (body && !mp) throw new Unsupported(`CALL METHOD form: ${text}`);
    const args = (mp?.findAllExpressions(Expressions.ParameterS) ?? []).map((p) => ({name: upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()),
      value: convert(source(p.findDirectExpression(Expressions.Source), ctx), {k: "data"})}));
    const method = upper(kids[2].concatTokens());
    (ctx.program.dynStatics ??= new Set()).add(method);
    return {s: "call_dyn_static", cls, method, args};
  }
  if (isStmt(node, Statements.CallFunction)) return callFunction(node, ctx, text);
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
    // MODIFY itab INDEX n FROM wa, and the same written MODIFY itab FROM wa
    // INDEX n (the order of the two additions is free; open-abap-gui's
    // CL_GUI_CONTROL writes the second): each Source is the one after its word
    const indexFirst = /^MODIFY\s+\S+\s+INDEX\s+.+\s+FROM\s+/i.test(text);
    if (!(indexFirst || /^MODIFY\s+\S+\s+FROM\s+.+\s+INDEX\s+/i.test(text)) || /\b(TRANSPORTING|USING\s+KEY|ASSIGNING|REFERENCE\s+INTO)\b/i.test(text)) throw new Unsupported(`MODIFY form: ${text}`);
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (table.type.k !== "table") throw new Unsupported("MODIFY of a non-table");
    const kids = node.getChildren();
    const after = (kw) => { const at = kids.findIndex((c) => isTok(c, kw)); return at < 0 || !isExpr(kids[at + 1], Expressions.Source) ? undefined : kids[at + 1]; };
    const idx = after("INDEX");
    const val = after("FROM");
    if (!idx || !val || node.findDirectExpressions(Expressions.Source).length !== 2) throw new Unsupported(`MODIFY form: ${text}`);
    return {s: "modify_index", table, index: convert(source(idx, ctx, I), I), value: convert(source(val, ctx, table.type.row), table.type.row)};
  }
  if (isStmt(node, Statements.Split)) return splitStatement(node, ctx, text);
  if (isStmt(node, Statements.MoveCorresponding)) return moveCorresponding(node, ctx, text);
  if (isStmt(node, Statements.Find)) {
    // FIND [FIRST OCCURRENCE OF] [REGEX] p IN s [IGNORING CASE] [SUBMATCHES a b ...]
    // [MATCH OFFSET o] [MATCH LENGTH l]; measured on A4H: POSIX leftmost-
    // longest, offsets in characters, a failed FIND leaves every target alone,
    // a submatch target without a group (or of a group that did not take
    // part) becomes initial.
    // ultra/sadl (A4H 2026-09-24, ZCL_GOGEN_T_FINDSEC): IN SECTION [OFFSET o]
    // [LENGTH l] OF s for a substring in a string (MATCH OFFSET counts from
    // the start of s, not of the section), and IN TABLE itab of strings
    // [MATCH LINE n] (row by row, the first row with a match). REGEX IN
    // SECTION stays refused: what ^ and $ see there is not measured.
    const kids = node.getChildren();
    const words = kids.map((k) => (k instanceof Nodes.TokenNode ? upper(k.concatTokens()) : ""));
    if (words.includes("ALL") || /\b(RESULTS|MATCH\s+COUNT|IN\s+BYTE\s+MODE|RESPECTING)\b/i.test(text)) throw new Unsupported(`FIND form: ${text}`);
    const ft = node.findDirectExpression(Expressions.FindType);
    const kind = ft ? upper(ft.concatTokens()) : "";
    if (kind && kind !== "REGEX") throw new Unsupported(`FIND ${kind}`);
    const inTable = words.some((w, i) => w === "IN" && words[i + 1] === "TABLE");
    const section = words.includes("SECTION");
    if (section && (kind === "REGEX" || inTable)) throw new Unsupported(`FIND form: ${text}`);
    // the Sources in order: pattern, [section offset], [section length], subject
    const srcs = [];
    let smode = "pat";
    for (let i = 0; i < kids.length; i += 1) {
      const w = words[i];
      if (w === "SECTION") { smode = "sec"; continue; }
      if (smode === "sec" && w === "OFFSET") { smode = "secoff"; continue; }
      if (smode !== "pat" && smode !== "subj" && w === "LENGTH") { smode = "seclen"; continue; }
      if (smode !== "pat" && w === "OF") { smode = "subj"; continue; }
      if (isExpr(kids[i], Expressions.Source)) srcs.push({mode: smode === "pat" && srcs.length > 0 ? "subj" : smode, node: kids[i]});
    }
    const pat = srcs.find((x) => x.mode === "pat")?.node;
    const subj = srcs.find((x) => x.mode === "subj")?.node;
    if (!pat || !subj) throw new Unsupported(`FIND operands: ${text}`);
    const patX = source(pat, ctx);
    if (!charlike(patX.type)) throw new Unsupported(`FIND of a ${patX.type.k}`);
    const out = {s: "find", regex: kind === "REGEX", pattern: convert(patX, S),
      icase: /\bIGNORING\s+CASE\b/i.test(text), subs: [], off: null, len: null};
    if (inTable) {
      const tb = source(subj, ctx);
      if (tb.type.k !== "table" || tb.type.row.k !== "string") throw new Unsupported(`FIND IN TABLE of a ${tb.type.k === "table" ? `table of ${tb.type.row.k}` : tb.type.k}`);
      out.table = tb;
    } else if (section) {
      const sx = source(subj, ctx);
      if (sx.type.k !== "string") throw new Unsupported(`FIND IN SECTION of a ${sx.type.k}`);
      out.subject = sx;
      const so = srcs.find((x) => x.mode === "secoff")?.node;
      const sl = srcs.find((x) => x.mode === "seclen")?.node;
      out.secOff = so ? convert(source(so, ctx, I), I) : null;
      out.secLen = sl ? convert(source(sl, ctx, I), I) : null;
    } else out.subject = convert(source(subj, ctx), S);
    let mode = null;
    for (let i = 0; i < kids.length; i += 1) {
      const w = words[i];
      if (w === "SUBMATCHES") { mode = "sub"; continue; }
      if (w === "MATCH" && words[i + 1] === "OFFSET") { mode = "off"; i += 1; continue; }
      if (w === "MATCH" && words[i + 1] === "LENGTH") { mode = "len"; i += 1; continue; }
      if (w === "MATCH" && words[i + 1] === "LINE") { mode = "line"; i += 1; continue; }
      if (w) { mode = null; continue; }
      if (!isExpr(kids[i], Expressions.Target) || mode === null) continue;
      const t = lvalue(kids[i], ctx);
      if (mode === "sub") {
        if (!charlike(t.type)) throw new Unsupported(`SUBMATCHES into a ${t.type.k}`);
        out.subs.push({target: t, value: convert({e: "temp", name: `fsub[${out.subs.length}]`, type: S}, t.type)});
      } else {
        if (t.type.k !== "i") throw new Unsupported(`MATCH ${mode.toUpperCase()} into a ${t.type.k}`);
        if (mode === "line" && !inTable) throw new Unsupported(`MATCH LINE without IN TABLE: ${text}`);
        out[mode] = t;
      }
    }
    return out;
  }
  if (isStmt(node, Statements.Clear)) {
    const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    // CLEAR of generic data clears the slot it is bound to
    if (target.type.k === "data") {
      if (/\bWITH\b/i.test(text)) throw new Unsupported(`CLEAR form: ${text}`);
      return {s: "clear_data", target};
    }
    return {s: "clear", target};
  }
  // FREE is CLEAR that also gives the memory back, which a GC does anyway
  if (isStmt(node, Statements.Free)) return {s: "seq", body: node.findDirectExpressions(Expressions.Target).map((t) => lvalue(t, ctx)).map((target) => ({s: target.type.k === "data" ? "clear_data" : "clear", target}))};
  // WRITE goes to a list; in an APC or HTTP handler nobody ever displays it
  // WRITE is a no-op here, except the transpiler runtime's host code: open-abap-core
  // writes its kernel parts in JS as WRITE '@KERNEL ...', and skipping one would
  // run the ABAP around it on values nobody set
  if (isStmt(node, Statements.Write)) {
    // a kernel line the host implements (KERNEL)
    const k = kernelOf(node, ctx);
    if (k?.fn !== undefined) return {s: "native", fn: k.fn, args: nativeArgs(k.args, ctx), stmt: true};
    if (k?.bound !== undefined && ctx.kernelLoop?.binds.includes(k.bound)) return {s: "nop"};
    if (/'@KERNEL/i.test(node.concatTokens())) throw new Unsupported(`@KERNEL: host code of the transpiler runtime`);
    return {s: "nop"};
  }
  throw new Unsupported(`statement ${node.get().constructor.name}: ${text}`);
}

/* ------------------------------------------------------------ strings (A4H) */

// A c operand keeps its trailing blanks where ABAP keeps them: the
// separator of SPLIT (measured, 'a ' splits `a b` into '' and 'b'). A c
// value is stored without them, so its declared length pads it back.
function padded(x) {
  const v = convert(x, S);
  return x.type.k === "c" ? {e: "padc", x: v, n: x.type.len, type: S} : v;
}

function splitStatement(node, ctx, text) {
  // measured on A4H: an empty string gives no rows, and one empty last
  // piece after a trailing separator is dropped (a| -> [a], a|| -> [a,'']);
  // an empty separator does not split; a c separator keeps its blanks
  if (/\bIN\s+BYTE\s+MODE\b/i.test(text)) throw new Unsupported(`SPLIT form: ${text}`);
  const [strNode, sepNode] = node.findDirectExpressions(Expressions.Source);
  const str = source(strNode, ctx);
  if (!charlike(str.type)) throw new Unsupported(`SPLIT of a ${str.type.k}`);
  const sepX = source(sepNode, ctx);
  if (!charlike(sepX.type)) throw new Unsupported(`SPLIT AT a ${sepX.type.k}`);
  const x = convert(str, S);
  const sep = padded(sepX);
  const targets = node.findDirectExpressions(Expressions.Target);
  if (/\bINTO\s+TABLE\b/i.test(text)) {
    const table = lvalue(targets[0], ctx);
    if (table.type.k !== "table" || table.type.row.k !== "string") throw new Unsupported("SPLIT into a table not of strings");
    return {s: "split", table, x, sep};
  }
  // INTO t1 t2 ...: measured, the last target takes the rest (a,b,c,d into
  // two is a / b,c,d), missing pieces clear their targets, a piece longer
  // than its c field is cut and sy-subrc is 4
  const places = targets.map((t) => lvalue(t, ctx));
  for (const t of places) if (t.type.k !== "string" && t.type.k !== "c") throw new Unsupported(`SPLIT INTO a ${t.type.k}`);
  return {s: "split_into", x, sep, lens: places.map((t) => (t.type.k === "c" ? t.type.len : -1)),
    targets: places.map((t, i) => ({target: t, value: convert({e: "temp", name: `spl[${i}]`, type: S}, t.type)}))};
}

function replaceStatement(node, ctx, text) {
  // REPLACE [FIRST OCCURRENCE OF | ALL OCCURRENCES OF] [REGEX] p IN
  // [SECTION [OFFSET o] [LENGTH l] OF] v WITH w [IGNORING CASE]; every rule
  // measured on A4H 2026-09-23, see abap.ReplaceStmt
  if (/\b(PCRE|RESPECTING|IN\s+BYTE\s+MODE|REPLACEMENT|RESULTS|INTO)\b/i.test(text) || !/\bOF\b/i.test(text)) throw new Unsupported(`REPLACE form: ${text}`);
  const kids = node.getChildren();
  const words = kids.map((k) => (k instanceof Nodes.TokenNode ? upper(k.concatTokens()) : ""));
  if (words.includes("SECTION") && !words.includes("OCCURRENCE") && !words.includes("OCCURRENCES")) throw new Unsupported(`REPLACE SECTION form: ${text}`);
  const ft = node.findDirectExpression(Expressions.FindType);
  const kind = ft ? upper(ft.concatTokens()) : "";
  if (kind && kind !== "REGEX" && kind !== "SUBSTRING") throw new Unsupported(`REPLACE ${kind}`);
  const regex = kind === "REGEX";
  let pat = null, off = null, len = null, wth = null, mode = "pat";
  for (let i = 0; i < kids.length; i += 1) {
    const w = words[i];
    if (w === "OFFSET") { mode = "off"; continue; }
    if (w === "LENGTH") { mode = "len"; continue; }
    if (w === "WITH") { mode = "with"; continue; }
    if (!isExpr(kids[i], Expressions.Source)) continue;
    if (mode === "pat" && pat === null) pat = kids[i];
    else if (mode === "off") off = kids[i];
    else if (mode === "len") len = kids[i];
    else if (mode === "with") wth = kids[i];
  }
  if (pat === null || wth === null) throw new Unsupported(`REPLACE operands: ${text}`);
  if (regex && (off || len)) throw new Unsupported(`REPLACE REGEX IN SECTION: what an anchor sees there is not measured: ${text}`);
  const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
  if (target.type.k !== "string" && target.type.k !== "c") throw new Unsupported(`REPLACE in a ${target.type.k}`);
  const p = source(pat, ctx);
  const w = source(wth, ctx);
  if (!charlike(p.type) || !charlike(w.type)) throw new Unsupported(`REPLACE operands of ${p.type.k} / ${w.type.k}`);
  return {s: "replace", target, pattern: convert(p, S), with: convert(w, S), regex, all: words.includes("ALL"),
    icase: /\bIGNORING\s+CASE\b/i.test(text), off: off ? convert(source(off, ctx, I), I) : null, len: len ? convert(source(len, ctx, I), I) : null,
    cLen: target.type.k === "c" ? target.type.len : -1};
}

// MOVE-CORRESPONDING a TO b between structures: every component of b whose
// name a has too gets a's value by the conversion rules, the others are
// left alone, sy-subrc too (measured on A4H). A component that is itself a
// structure or a table on either side is not flat and is refused.
function moveCorresponding(node, ctx, text) {
  if (/\b(EXPANDING|KEEPING)\b/i.test(text)) throw new Unsupported(`MOVE-CORRESPONDING form: ${text}`);
  const from = source(node.findDirectExpression(Expressions.Source), ctx);
  const tNode = node.findDirectExpression(Expressions.SimpleTarget) ?? node.findDirectExpression(Expressions.Target);
  const to = lvalue(tNode, ctx);
  if ((from.type.k === "data" || to.type.k === "data") && ["data", "struct"].includes(from.type.k) && ["data", "struct"].includes(to.type.k)) {
    // generic on one side or both: component by component at run time,
    // through bindings to the two structures
    return {s: "move_corr_data", from: convert(from, {k: "data"}), to: convert(to, {k: "data"})};
  }
  if (from.type.k !== "struct" || to.type.k !== "struct") throw new Unsupported(`MOVE-CORRESPONDING from a ${from.type.k} to a ${to.type.k}`);
  // each component names source and target again, so both must be places
  // that cost nothing and do nothing when named twice: a variable, an
  // attribute, a field symbol or a component of one (a table expression, a
  // dereference or a call would run once per component where ABAP runs it once)
  const plain = (x) => ["var", "attr", "static", "fs"].includes(x.e) || (x.e === "field" && plain(x.base));
  if (!plain(from) || !plain(to)) throw new Unsupported(`MOVE-CORRESPONDING of something other than a variable or its component: ${text}`);
  const src = structOf(ctx, from.type);
  const dst = structOf(ctx, to.type);
  if (!src || !dst) throw new Unsupported(`MOVE-CORRESPONDING: a structure not in the program`);
  const body = [];
  for (const f of dst.fields) {
    const g = src.fields.find((x) => x.name === f.name);
    if (!g) continue;
    if (["struct", "table"].includes(f.type.k) || ["struct", "table"].includes(g.type.k)) throw new Unsupported(`MOVE-CORRESPONDING with a deep component ${f.name}`);
    body.push({s: "assign", target: {e: "field", base: to, name: f.name, type: f.type}, value: convert({e: "field", base: from, name: g.name, type: g.type}, f.type)});
  }
  return {s: "seq", body};
}

// the built-in string functions: repeat( ) replace( ) condense( )
// shift_left( ) shift_right( ) to_mixed( ), measured on A4H 2026-09-23. A c
// argument loses its trailing blanks (replace( ) with sub = ' ' raises for
// an empty sub), which is how a c value is stored here already.
const STRING_FNS = {
  REPEAT: ["VAL", "OCC"], REPLACE: ["VAL", "SUB", "REGEX", "WITH", "OCC"], CONDENSE: ["VAL", "DEL", "FROM", "TO"],
  SHIFT_LEFT: ["VAL", "PLACES", "CIRCULAR", "SUB"], SHIFT_RIGHT: ["VAL", "PLACES", "CIRCULAR", "SUB"], TO_MIXED: ["VAL", "SEP", "CASE", "MIN"],
};
function stringFn(name, direct, named, ctx, text) {
  const ps = named?.findDirectExpressions(Expressions.ParameterS) ?? [];
  const given = new Map(ps.map((p) => [upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()), p.findDirectExpression(Expressions.Source)]));
  if (direct) given.set("VAL", direct);
  for (const k of given.keys()) if (!STRING_FNS[name].includes(k)) throw new Unsupported(`${name.toLowerCase()}( ) with ${k.toLowerCase()}: ${text}`);
  if (!given.has("VAL")) throw new Unsupported(`${name.toLowerCase()}( ) without val: ${text}`);
  const chars = (k) => {
    const x = source(given.get(k), ctx);
    if (!charlike(x.type)) throw new Unsupported(`${name.toLowerCase()}( ) ${k.toLowerCase()} of a ${x.type.k}`);
    return convert(x, S);
  };
  const int = (k) => convert(source(given.get(k), ctx, I), I);
  const val = chars("VAL");
  if (name === "REPEAT") {
    if (!given.has("OCC")) throw new Unsupported(`repeat( ) without occ: ${text}`);
    return {e: "str_fn", fn: "Repeat", args: [val, int("OCC")], type: S};
  }
  if (name === "REPLACE") {
    if (given.has("SUB") === given.has("REGEX") || !given.has("WITH")) throw new Unsupported(`replace( ) form: ${text}`);
    const regex = given.has("REGEX");
    return {e: "str_fn", fn: "ReplaceFn", args: [val, chars(regex ? "REGEX" : "SUB"), chars("WITH"), {e: "flag", value: regex},
      given.has("OCC") ? int("OCC") : {e: "int", value: 1, type: I}], type: S};
  }
  if (name === "CONDENSE") {
    // a c del / from / to loses its trailing blanks (A4H 2026-09-23, probe
    // ZCL_GOGEN_T_STRCR: del = space, del = ' ', del = a c(1) field holding
    // a blank and from = space all strip or match nothing; to = space
    // replaces a run with nothing), which is how a c value is stored here
    const set = (k) => (given.has(k) ? chars(k) : {e: "str", value: " ", type: S});
    return {e: "str_fn", fn: "CondenseFn", args: [val, set("DEL"), set("FROM"), set("TO")], type: S};
  }
  if (name === "SHIFT_LEFT" || name === "SHIFT_RIGHT") {
    const kinds = ["PLACES", "CIRCULAR", "SUB"].filter((k) => given.has(k));
    if (kinds.length > 1) throw new Unsupported(`${name.toLowerCase()}( ) form: ${text}`);
    const kind = kinds[0] ?? "";
    return {e: "str_fn", fn: "ShiftFn", args: [val, {e: "flag", value: name === "SHIFT_LEFT"}, {e: "str", value: kind.toLowerCase(), type: S},
      kind === "PLACES" || kind === "CIRCULAR" ? int(kind) : {e: "int", value: 0, type: I}, kind === "SUB" ? chars("SUB") : {e: "str", value: "", type: S}], type: S};
  }
  // TO_MIXED
  return {e: "str_fn", fn: "ToMixed", args: [val, given.has("SEP") ? chars("SEP") : {e: "str", value: "_", type: S}, {e: "flag", value: given.has("CASE")},
    given.has("CASE") ? chars("CASE") : {e: "str", value: "", type: S}, given.has("MIN") ? int("MIN") : {e: "int", value: 1, type: I}], type: S};
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
/**
 * ultra/itab (critic fix): a field symbol whose row a DELETE itab (the
 * current row) removed is not used again, since what it then points to was
 * not measured. Textual order over-approximates control flow on purpose:
 * inside a later LOOP ... ASSIGNING of the same name it is fresh again, and
 * everywhere else after the DELETE (the rest of that body, after the loop)
 * it is refused.
 */
function fsCheck(n, ctx) {
  if (!ctx.fsGone?.has(n)) return;
  const fresh = ctx.fsFresh?.findLast((f) => f.name === n);
  if (!fresh || fresh.stale) throw new Unsupported(`${n} used after DELETE of its row inside the LOOP: not measured`);
}

function variable(name, ctx) {
  const n = upper(name);
  // me as a value: the object itself (in Go its most-derived self)
  if (n === "ME") return {e: "me", type: {k: "ref", name: ctx.className}};
  if (ctx.fieldSymbols?.has(n)) { fsCheck(n, ctx); return {e: "fs", name: n, type: ctx.fieldSymbols.get(n)}; }
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

/** whether a name resolves as a variable the way variable() resolves it
 * (field symbol, parameter, returning, local, attribute), without its side
 * effects */
function isVariableName(name, ctx) {
  const n = upper(name);
  if (n === "ME" || ctx.fieldSymbols?.has(n)) return true;
  if (ctx.sig.params.some((x) => x.name === n) || ctx.sig.returning?.name === n || ctx.locals.has(n)) return true;
  const impl = findScope(ctx.spaghetti.getTop(), "class_implementation", ctx.scopeName ?? ctx.className);
  const defs = findScope(ctx.spaghetti.getTop(), "class_definition", ctx.scopeName ?? ctx.className);
  return (impl?.getData().vars[n] ?? defs?.getData().vars[n]) !== undefined;
}

function findAttribute(ctx, n) {
  if (n === "ME" || n === "SUPER") return undefined;
  // instance and static attributes are declared in the class definition's
  // scope, constants and interface constants show in the implementation's
  const impl = findScope(ctx.spaghetti.getTop(), "class_implementation", ctx.scopeName ?? ctx.className);
  const defs = findScope(ctx.spaghetti.getTop(), "class_definition", ctx.scopeName ?? ctx.className);
  const id = impl?.getData().vars[n] ?? defs?.getData().vars[n];
  if (id === undefined) return undefined;
  if (n.includes("~") && !(id instanceof abaplint.Types.ClassConstant) && !id.getMeta().includes("static")) return ownIntfAttribute(ctx, n);
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
      place = refAttribute(place, kids[i + 1], ctx, true);
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
function refAttribute(base, attrNode, ctx, write = false) {
  if (base.type.k === "ref" && base.type.intf && base.type.name !== "OBJECT") return intfRefAttribute(base, upper(attrNode.concatTokens()), ctx, write);
  if (base.type.k === "ref" && !base.type.intf && attrNode.concatTokens().includes("~")) return classRefIntfAttribute(base, upper(attrNode.concatTokens()), ctx, write);
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

/* ------------------------------------------------------ interface attributes */

/*
 * DATA of an interface is a field of every object whose class implements
 * the interface: INTF~ATTR in the class, ref->attr through a reference to
 * the interface, ref->intf~attr through a class reference or through a
 * reference to an interface that includes INTF. Measured on A4H
 * (ZCL_GOGEN_T_IA, 2026-09-23): one field, written through either reference
 * and read through the other; READ-ONLY is writable in the implementing
 * class and its subclasses (through me and through a reference of the
 * class's type), never through an interface reference, and not at all
 * outside; VALUE on an interface DATA does not activate; lo_i->intf~attr
 * naming the reference's own interface does not either. VALUE and the
 * READ-ONLY writes are syntax errors abaplint does not report, so the front
 * end refuses them; the last one abaplint does report, and the refusal here
 * only matters to a tolerant survey. A subclass that implements an interface
 * its superclass already implements (through an included one) shares the
 * superclass's field (A4H, ZCL_GOGEN_T_IADUP). The refusals are checked by
 * semantics.mjs against testdata-refused/.
 */

/** the DATA and CLASS-DATA of one interface (not of those it includes), cached */
function ownInterfaceAttributes(program, intf) {
  program.intfOwnAttrs ??= new Map();
  if (program.intfOwnAttrs.has(intf)) return program.intfOwnAttrs.get(intf);
  const obj = program.reg.getObject("INTF", intf);
  const def = obj?.getDefinition();
  const out = [];
  program.intfOwnAttrs.set(intf, out);
  if (!def) return out;
  // READ-ONLY and VALUE are read off the statement: abaplint's attribute of
  // an interface carries neither (its meta is empty). Only the statements
  // that declare an attribute count: a DATA BEGIN OF block is its DataBegin,
  // and the components inside it are not attributes
  const stmts = new Map();
  const walk = (node) => {
    for (const c of node.getChildren()) {
      if (isStmt(c, Statements.Data) || isStmt(c, Statements.DataBegin)) {
        const n = c.findDirectExpression(Expressions.DefinitionName) ?? c.findFirstExpression(Expressions.DefinitionName);
        if (n && !stmts.has(upper(n.concatTokens()))) stmts.set(upper(n.concatTokens()), c);
      } else if (isStruct(c, Structures.Data)) {
        const begin = c.findDirectStatement(Statements.DataBegin);
        const n = begin?.findDirectExpression(Expressions.DefinitionName);
        if (n && !stmts.has(upper(n.concatTokens()))) stmts.set(upper(n.concatTokens()), begin);
      } else if (c instanceof Nodes.StructureNode) walk(c);
    }
  };
  const top = obj.getMainABAPFile()?.getStructure();
  if (top) walk(top);
  const readOnly = (st) => {
    const t = st?.getTokens().map((x) => upper(x.getStr())) ?? [];
    return t.some((x, i) => x === "READ" && t[i + 1] === "-" && t[i + 2] === "ONLY");
  };
  for (const a of def.getAttributes().getInstance()) {
    const name = `${intf}~${upper(a.getName())}`;
    const st = stmts.get(upper(a.getName()));
    const entry = {name, intf, readOnly: readOnly(st)};
    if (st?.findFirstExpression(Expressions.Value)) entry.unsupported = `${name}: VALUE on an interface DATA does not activate on A4H`;
    else {
      try { entry.type = typeOf(a.getType(), name, program); } catch (e) { if (!(e instanceof Unsupported)) throw e; entry.unsupported = e.message; }
    }
    out.push(entry);
  }
  for (const a of def.getAttributes().getStatic()) {
    const name = `${intf}~${upper(a.getName())}`;
    out.push({name, intf, static: true, unsupported: `${name}: CLASS-DATA of an interface is not in the subset`});
  }
  return out;
}

/** the attributes of an interface and of every interface it includes */
function interfaceAttributes(program, intf) {
  program.interfaceAttrs ??= new Map();
  if (!program.interfaceAttrs.has(intf)) {
    program.interfaceAttrs.set(intf, [intf, ...componentInterfaces(program.reg, intf)].flatMap((i) => ownInterfaceAttributes(program, i)));
  }
  return program.interfaceAttrs.get(intf);
}

/** the fields a class gets for the interfaces it implements itself (a subclass inherits them) */
function implementedAttributes(program, implemented) {
  return implemented.flatMap((i) => ownInterfaceAttributes(program, i)).filter((a) => !a.static)
    .map((a) => (a.unsupported ? {name: a.name, unsupported: a.unsupported} : {name: a.name, type: a.type, static: false, fromIntf: a.intf, readOnly: a.readOnly}));
}

/** INTF~ATTR inside a class that implements INTF (or inherits it) */
function ownIntfAttribute(ctx, n) {
  const intf = n.slice(0, n.lastIndexOf("~"));
  const a = ownInterfaceAttributes(ctx.program, intf).find((x) => x.name === n);
  if (a === undefined) throw new Unsupported(`${n}: not an attribute of ${intf} (an alias?)`);
  if (a.unsupported) throw new Unsupported(a.unsupported);
  return {e: "attr", name: n, type: a.type};
}

/** ref->attr and ref->comp~attr through a reference to an interface */
function intfRefAttribute(base, name, ctx, write) {
  const intf = base.type.name;
  if (name.includes("~")) {
    const pre = name.slice(0, name.lastIndexOf("~"));
    // measured on A4H: lo_i->zif_i~a on a reference to zif_i is a syntax error
    if (!componentInterfaces(ctx.reg, intf).includes(pre)) throw new Unsupported(`${intf}->${name}: ${pre} is not an interface ${intf} includes`);
  }
  const full = name.includes("~") ? name : `${intf}~${name}`;
  const a = interfaceAttributes(ctx.program, intf).find((x) => x.name === full);
  if (a === undefined) {
    // a constant or a CLASS-DATA read through the reference is ABAP too, but
    // not in the subset; say so rather than suspect an alias
    const [pre, comp] = full.split("~");
    const idef = ctx.reg.getObject("INTF", pre)?.getDefinition();
    if (idef?.getAttributes().getConstants().some((x) => upper(x.getName()) === comp)) {
      throw new Unsupported(`${intf}->${name}: a constant through an interface reference is not in the subset`);
    }
    if (idef?.getAttributes().getStatic().some((x) => upper(x.getName()) === comp)) {
      throw new Unsupported(`${intf}->${name}: a static attribute through an interface reference is not in the subset`);
    }
    throw new Unsupported(`${intf}->${name}: not an attribute of the interface (an alias?)`);
  }
  if (a.unsupported) throw new Unsupported(a.unsupported);
  if (write && a.readOnly) throw new Unsupported(`${intf}->${name}: a write to a READ-ONLY attribute through an interface reference (a syntax error on A4H)`);
  return {e: "refattr", base, name: full, type: a.type};
}

/** ref->intf~attr through a reference to a class that implements intf */
function classRefIntfAttribute(base, name, ctx, write) {
  const pre = name.slice(0, name.lastIndexOf("~"));
  // the topmost class that implements it: the field is its, and a subclass
  // implementing the same interface again shares it
  const owner = [base.type.name, ...ancestors(ctx.reg, base.type.name)].findLast((c) => (ctx.reg.getObject("CLAS", c)?.getDefinition()?.getImplementing() ?? [])
    .some((i) => upper(i.name) === pre || componentInterfaces(ctx.reg, upper(i.name)).includes(pre)));
  if (owner === undefined) throw new Unsupported(`${base.type.name}->${name}: the class does not implement ${pre}`);
  if (!ctx.program.wanted.has(owner)) throw new Unsupported(`${base.type.name}->${name}: ${owner}, which implements ${pre}, is not compiled`);
  const a = ownInterfaceAttributes(ctx.program, pre).find((x) => x.name === name);
  if (a === undefined) throw new Unsupported(`${base.type.name}->${name}: not an attribute of ${pre} (an alias?)`);
  if (a.unsupported) throw new Unsupported(a.unsupported);
  const inside = ctx.className === owner || ancestors(ctx.reg, ctx.className).includes(owner);
  if (write && a.readOnly && !inside) throw new Unsupported(`${base.type.name}->${name}: a write to a READ-ONLY attribute outside ${owner} (a syntax error on A4H)`);
  return {e: "refattr", base, name, type: a.type};
}

/* --------------------------------------------------------------- expressions */

const SY = {"SY-INDEX": "Index", "SY-TABIX": "Tabix", "SY-SUBRC": "Subrc", "SY-DBCNT": "Dbcnt"};
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
    } else if (isExpr(k, Expressions.MethodCallChain) && isTok(kids[i + 1], "-") && isExpr(kids[i + 2], Expressions.ComponentChain)) {
      // m( )-comp: a component of what the call returns
      out.push({node: k, comps: kids[i + 2]});
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
      else if (it.node && it.comps) out.push(componentsOf(sourceOperand(it.node, ctx), it.comps, ctx).type);
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
  // ultra/itab: a generic operand or a generic target decides the
  // calculation type at run time (genericArith)
  if (outer?.k === "data" || leafTypes(node, ctx).some((t) => t.k === "data")) return genericArith(node, ctx, outer);
  // an x target computes as i and the i result is converted into it
  // (measured on A4H 2026-09-23 for i MOD 256 into x LENGTH 1: 255 and -1
  // both give FF, 300 gives 2C)
  const target = outer?.k === "x" ? I : outer;
  const leaves = leafTypes(node, ctx);
  // a character target (c, string) does not take part: the calculation
  // type of `s = i + 1` is not measured, so it is refused below unless the
  // operands decide it (a p or character operand: p, an f: f)
  const charTarget = target !== undefined && charlike(target);
  const types = [...leaves, ...(target === undefined || charTarget ? [] : [target])];
  // ** computes in f when the operands are integers (measured on A4H:
  // 2 ** 31 into i overflows "converting from '2.14748e+09'")
  if (types.some((t) => t.k === "f") || hasPow(node)) return arith(node, ctx, F);
  if (types.some((t) => t.k === "x")) throw new Unsupported(`calculation type of an x operand: ${node.concatTokens()}`);
  // calculation type p (A4H 2026-09-24, ZCL_GOGEN_T_PDCALC): a p operand or
  // a p target, and a c or string operand too (`lv_s / 2 * 2` into i is 7
  // for lv_s = '7', not 8), ahead of int8 (int8 / 3 into p is
  // 1666666666.67). + - * are exact, / keeps 31 significant digits
  if (types.some((t) => t.k === "p" || charlike(t))) {
    const odd = types.find((t) => !["p", "i", "int8", "c", "string"].includes(t.k));
    if (odd) throw new Unsupported(`calculation type p with a ${odd.k} operand: ${node.concatTokens()}`);
    return arith(node, ctx, P31);
  }
  if (charTarget) throw new Unsupported(`calculation type of ${node.concatTokens()} into a character field: not measured`);
  if (types.some((t) => t.k === "int8")) return arith(node, ctx, INT8);
  // a d operand counts its days as an i (measured on A4H: ( d / 7 ) * 7
  // into i rounds in between, so the calculation type is i, not p); a d
  // target (days back into a date) is not measured
  if (types.some((t) => t.k === "d") && outer?.k !== "d" && types.every((t) => t.k === "i" || t.k === "d")) return arith(node, ctx, I);
  if (types.every((t) => t.k === "i")) return arith(node, ctx, I);
  throw new Unsupported(`calculation type of ${node.concatTokens()}`);
}

/*
 * ultra/itab: arithmetic with a generic operand (TYPE any) or into a generic
 * target. A4H 2026-09-24 (ZCL_GOGEN_T_GENAR, $ZOSG_TMP_0400): the
 * calculation type is the one the static rule above gives for the types the
 * field symbols have at run time, as if they had been declared with them
 * ("<a> / 2 * 2" into i is 8 for an i, 7 for a c, a string, an n and a p
 * 7.50, 8 for an f; a p target makes it p). So every calculation type that
 * can come out is compiled here as ordinary typed arithmetic, a generic
 * operand read into that type (unwrap_calc), and abap.CalcKind picks the
 * branch at run time from the static kinds, the operands' descriptors and
 * the target's. A branch that does not compile, and a combination the static
 * rule refuses (a character target of an i result, a d or x operand), is
 * NOT_COMPILED when it is reached, not before. A generic operand is read
 * twice (kind, then value), so only a place is taken.
 */
let GEN_CALC = false;
const CALC_CODE = {i: "I", int8: "8", f: "F", p: "P", c: "C", string: "g", n: "N", d: "D", t: "T", x: "X", xstring: "y"};
function genericArith(node, ctx, outer) {
  const text = node.concatTokens();
  if (outer === undefined) throw new Unsupported(`arithmetic with a generic operand outside an assignment: ${text}`);
  if (hasBitOp(node)) throw new Unsupported(`bit operation with a generic operand: ${text}`);
  const statics = [];
  for (const t of leafTypes(node, ctx)) {
    if (t.k === "data") continue;
    if (CALC_CODE[t.k] === undefined) throw new Unsupported(`calculation type with a ${t.k} operand: ${text}`);
    statics.push(CALC_CODE[t.k]);
  }
  // ** computes in f (the static rule)
  if (hasPow(node)) statics.push("F");
  let charTarget = false;
  if (outer.k !== "data") {
    if (charlike(outer)) charTarget = true;
    else if (outer.k === "x") statics.push("I");
    else if (["i", "int8", "f", "p"].includes(outer.k)) statics.push(CALC_CODE[outer.k]);
    else throw new Unsupported(`calculation type of ${text} into a ${outer.k}`);
  }
  const target = outer.k === "data" ? ctx.genTarget : null;
  if (outer.k === "data" && !target) throw new Unsupported(`generic arithmetic into a generic value that is not a target: ${text}`);
  const branches = {};
  let leaves = null;
  for (const [code, calc] of [["I", I], ["8", INT8], ["P", P31], ["F", F]]) {
    GEN_CALC = true;
    try {
      const v = arith(node, ctx, calc);
      if (leaves === null) {
        leaves = [];
        const walk = (n) => {
          if (Array.isArray(n)) { n.forEach(walk); return; }
          if (!n || typeof n !== "object") return;
          if (n.e === "unwrap_calc") { leaves.push(n.x); return; }
          for (const [k, x] of Object.entries(n)) if (k !== "type") walk(x);
        };
        walk(v);
      }
      branches[code] = outer.k === "data" ? {e: "wrap", x: v, type: {k: "data"}} : convert(v, outer);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      branches[code] = {reason: `calculation type ${calc.k} of ${text}: ${e.message}`};
    } finally {
      GEN_CALC = false;
    }
  }
  if (leaves === null) throw new Unsupported(`calculation type of ${text}: ${branches.I.reason}`);
  const PLACE = new Set(["var", "attr", "static", "field", "fs", "row", "refattr"]);
  for (const l of leaves) if (!PLACE.has(l.e)) throw new Unsupported(`a generic operand that is not a field in ${text}`);
  return {e: "gen_arith", statics: statics.join(""), charTarget, target, leaves, branches, text, type: outer.k === "data" ? {k: "data"} : outer};
}

/** a ComponentChain (a-b-c) read off a structured value */
function componentsOf(v, chain, ctx) {
  for (const c of chain.getChildren()) {
    if (isTok(c, "-")) continue;
    if (!isExpr(c, Expressions.ComponentName)) throw new Unsupported(`component chain ${chain.concatTokens()}`);
    const f = fieldOf(ctx, v.type, c.concatTokens(), chain.concatTokens());
    v = {e: "field", base: v, name: f.name, type: f.type};
  }
  return v;
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
    let v = sourceOperand(item.node, ctx, item.hint);
    if (item.comps) v = componentsOf(v, item.comps, ctx);
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
  if (!numeric(expr.type) && expr.type.k !== "p") throw new Unsupported("unary minus on a non-number");
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
      // a number literal past the range of i is a p literal in ABAP (31
      // digits at most), held as its digits like every p value
      if (Math.abs(value) > 2147483647) {
        const digits = int.concatTokens().replace(/^\+/, "").replace(/^(-?)0+(?=\d)/, "$1");
        if (!/^-?\d{1,31}$/.test(digits)) throw new Unsupported(`integer literal ${int.concatTokens()}`);
        return {e: "str", value: digits, type: P31};
      }
      if (!Number.isSafeInteger(value)) throw new Unsupported(`integer literal ${value}`);
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
  // the logon client: the transpiler runtime's constant (abap.Mandt)
  if (text === "SY-MANDT") return {e: "sy_mandt", type: C(3)};
  // who the system is and its clock, as the host says (abap.SysID / UName,
  // the identity tools/osd-identity.mjs gives the Node boot: OSG, DEVELOPER;
  // date and time in UTC, as the transpiler runtime has them)
  if (text === "SY-SYSID") return {e: "sy_host", name: "SysID", type: C(8)};
  if (text === "SY-UNAME") return {e: "sy_host", name: "UName", type: C(12)};
  if (text === "SY-DATUM") return {e: "sy_host", name: "Datum()", type: {k: "d"}};
  if (text === "SY-UZEIT") return {e: "sy_host", name: "Uzeit()", type: {k: "t"}};
  // the database and the release, as the transpiler runtime has them on Node:
  // sy-dbsys the database client's name (c10, 'sqlite' for OSG's SQLite,
  // test/setup.mjs), sy-saprl its constant 'OPEN' (c4, @abaplint/runtime
  // builtin/sy.js); a system says 'HDB' and '758' (ultra/gaps)
  if (text === "SY-DBSYS") return {e: "sy_host", name: "DBSys", type: C(10)};
  if (text === "SY-SAPRL") return {e: "sy_host", name: "SapRl", type: C(4)};
  if (text === "ABAP_TRUE") return {e: "chars", value: "X", type: C(1)};
  if (text === "ABAP_FALSE") return {e: "chars", value: "", type: C(1)};
  // space: the c(1) blank, stored without its blank like every c value
  if (text === "SPACE") return {e: "chars", value: "", type: C(1)};
  if (text === "SY-ABCDE") return {e: "chars", value: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", type: C(26)};
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
  // a d or t is read as the c of its length (measured on A4H: t '123456'
  // gives 12 and 34 for (2) and +2(2) into i)
  if (base.type.k === "d" || base.type.k === "t") base = {...base, type: C(base.type.len)};
  const k = base.type.k;
  if (!["string", "c", "xstring", "x"].includes(k)) throw new Unsupported(`offset on a ${k}: ${node.concatTokens()}`);
  const litLen = len?.e === "int" ? len.value : undefined;
  const type = k === "string" ? S : k === "xstring" ? XS : k === "c" ? C(litLen ?? base.type.len) : X(litLen ?? base.type.len);
  return {e: "substr", x: base, off, len, base: base.type, type};
}

const CHAR_UTILITIES = {NEWLINE: "\n", CR_LF: "\r\n", HORIZONTAL_TAB: "\t", FORM_FEED: "\f", VERTICAL_TAB: "\v"};

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
  // an alias of an interface for a constant of an interface it includes
  // (IF_APC_WSP_EXTENSION=>CO_CONNECT_MODE_REJECT for
  // IF_APC_WSP_EXTENSION_COMMON~CO_CONNECT_MODE_REJECT)
  const alias = (def.getAliases?.() ?? []).find((x) => upper(x.getName()) === attr);
  const comp = alias === undefined ? [] : upper(alias.getComponent()).split("~");
  if (comp.length === 2 && comp[0] !== owner) return resolveStatic(comp[0], comp[1], ctx);
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
      if (p.suppliedOf) return {dir: "importing", byValue: true, type: p.type, value: {e: "chars", value: given.has(p.suppliedOf) ? "X" : "", type: p.type}};
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
  if (NATIVE_ME.has(key)) { ctx.program.sigs.set(key, nativeMeSig(ctx.program, key, name)); return ctx.program.sigs.get(key); }
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
      optional: optional.has(upper(x.getName())), defaultOwner: intf ?? declaringClass(ctx.reg, defOwner, meth, "method") ?? defOwner, defOwner: intf ?? declaringClass(ctx.reg, defOwner, meth, "method") ?? defOwner});
    const ret = p.getReturning();
    const own = [...p.getImporting().map((x) => param(x, "importing")), ...p.getExporting().map((x) => param(x, "exporting")),
      ...p.getChanging().map((x) => param(x, "changing"))];
    sig = {name, static: m.isStatic?.() ?? false,
      params: intf ? own : withSupplied(ctx.program, `${declaringClass(ctx.reg, defOwner, meth, "method") ?? defOwner}=>${meth}`, own),
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
/** the class of cls and its ancestors that lists intf in its INTERFACES */
function implementingClass(reg, cls, intf) {
  for (const c of [cls, ...ancestors(reg, cls)]) {
    const def = reg.getObject("CLAS", c)?.getDefinition();
    if (!def) return undefined;
    if (def.getImplementing().some((x) => upper(x.name) === intf)) return c;
  }
  return undefined;
}

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


/*
 * Open SQL through the shared relational IR (osg-i7's, tools/sqlscript-ir.mjs
 * lowered by tools/sqlscript-lower.mjs; ranges tools/ir-ranges.mjs, writes
 * tools/ir-writes.mjs). What is known at build time is lowered here, once:
 * a SELECT, an UPDATE ... SET ... WHERE, a DELETE FROM ... WHERE, with a
 * host value as a parameter and a range as a hostPred marker that the Go
 * runtime fills (go/abap/ranges.go, a port checked byte for byte against
 * the pairs). A write whose rows are a work area or an internal table is
 * built here with ir-writes' constructors and lowered once to refuse what
 * the IR refuses; its rows arrive at run time and the Go runtime renders
 * them with its port of the same lowering (go/abap/irsql.go, checked
 * against writes.json). MANDT is the logon client in every predicate and in
 * every row written, as a system does implicitly.
 */

/** a table of the dictionary: its columns (typed on demand), its key, whether it has a client */
function dbTable(ctx, tableName, verb) {
  // a DDIC view (the SQL views of OSG's CDS entities, created as SQLite views
  // by the transpiler's DatabaseSetup) is read like a table: its fields are
  // its columns, MANDT among them when it has one (ultra/sadl). It is never
  // written: a write to a view is refused
  const view = verb === "SELECT FROM" ? ctx.reg.getObject("VIEW", tableName) : undefined;
  const tabl = ctx.reg.getObject("TABL", tableName) ?? view;
  if (!tabl) throw new Unsupported(`${verb} ${tableName}: not a table of the dictionary in this program`);
  let tType;
  try { tType = tabl.parseType(ctx.reg); } catch { throw new Unsupported(`${verb} ${tableName}: its type does not resolve`); }
  if (!(tType instanceof BasicTypes.StructureType)) throw new Unsupported(`${verb} ${tableName}: its type does not resolve`);
  const columns = new Map(tType.getComponents().map((c) => [upper(c.name), c]));
  // a view over a client-dependent table that does not carry MANDT hides
  // the client: a system reads the logon client's rows (a CDS view's SQL view
  // has MANDT), this one would read every client's. Refused, not served
  // unfiltered (OSG's tools/cds2ddic.mjs leaves MANDT out of such views)
  if (tabl === view && !columns.has("MANDT")) {
    const hidden = [...new Set((view.getFields() ?? []).map((f) => upper(f.TABNAME)))].find((t) => {
      try {
        const bt = ctx.reg.getObject("TABL", t)?.parseType(ctx.reg);
        return bt instanceof BasicTypes.StructureType && bt.getComponents().some((c) => upper(c.name) === "MANDT");
      } catch { return false; }
    });
    if (hidden) throw new Unsupported(`${verb} ${tableName}: a view over the client-dependent ${hidden} without MANDT`);
  }
  const colType = (n) => {
    const c = columns.get(n);
    if (!c) throw new Unsupported(`${verb}: ${tableName} has no column ${n}`);
    return typeOf(c.type, `${tableName}-${n}`, ctx.program);
  };
  let key = [];
  try { key = tabl.listKeys?.(ctx.reg)?.map(upper) ?? []; } catch { key = []; }
  return {name: tableName, columns, colType, key, client: columns.has("MANDT")};
}

/** the IR type of a column in a predicate or a projection */
// a DEC column: its digits (2n-1 for p LENGTH n) and decimals, as the IR
// counts them (ANORMALIES NOTE packed-length-is-bytes)
const sqlIrType = (t) => (t.k === "i" ? RIR.T.int : t.k === "int8" ? RIR.T.int8 : t.k === "string" ? RIR.T.str : t.k === "d" ? RIR.T.date
  : t.k === "p" ? RIR.T.dec(2 * (t.len ?? 8) - 1, t.dec ?? 0) : RIR.T.char(t.len ?? 1));
/** the IR type a written value binds as (tools/ir-writes.mjs bindValue): a
 * d, t or n is its characters, as the column stores them */
function writeIrType(t, where) {
  if (t.k === "i") return RIR.T.int;
  if (t.k === "int8") return RIR.T.int8;
  if (t.k === "string") return RIR.T.str;
  if (t.k === "c" || t.k === "n") return RIR.T.char(t.len ?? 1);
  if (t.k === "d") return RIR.T.char(8);
  if (t.k === "t") return RIR.T.char(6);
  throw new Unsupported(`${where}: a column of kind ${t.k} is not written yet`);
}
const lowName = (n) => n.toLowerCase();
const mandtPred = () => RIR.bin("=", RIR.col("mandt", RIR.T.char(3)), RIR.param("SY-MANDT", RIR.T.char(3)), RIR.T.bool);
const andIr = (a, b) => (a === null ? b : b === null ? a : RIR.bin("AND", a, b, RIR.T.bool));

/** a host value of Open SQL: [@]name[-comp...], the parser leaving a
 * component after @ as siblings (Dash, SQLFieldName) */
function sqlHost(src, trailing, ctx, text) {
  const sk = [...src.getChildren().filter((c) => !isTok(c, "@")), ...trailing];
  const simple = sk[0];
  if (isExpr(simple, Expressions.Source)) {
    if (sk.length !== 1) throw new Unsupported(`SQL value: ${text}`);
    return source(simple, ctx);
  }
  if (!isExpr(simple, Expressions.SimpleSource3) || simple.getChildren().length !== 1) throw new Unsupported(`SQL value: ${text}`);
  let v = sourceOperand(simple.getFirstChild(), ctx);
  for (let i = 1; i < sk.length; i += 2) {
    if (!isTok(sk[i], "-") || !isExpr(sk[i + 1], Expressions.SQLFieldName)) throw new Unsupported(`SQL value: ${text}`);
    const f = fieldOf(ctx, v.type, sk[i + 1].concatTokens(), text);
    v = {e: "field", base: v, name: f.name, type: f.type};
  }
  return v;
}

/** a value compared with or written into a column: a literal of the
 * column's own kind is an IR literal, anything else a host value converted
 * to the column's type and bound at run time */
function sqlValue(v, ct, ir, acc) {
  if (v.e === "chars" && ct.k === "c" && v.value.length <= (ct.len ?? 1)) return RIR.lit(v.value, ir);
  if (v.e === "int" && ct.k === "i") return RIR.lit(v.value, ir);
  // a character value that may not fit the column: convert( ) would cut it,
  // and a cut value can compare equal to (or be written as) a different
  // key. A4H raises CX_SY_OPEN_SQL_DATA_ERROR for a range LOW longer than
  // the column; a plain comparison and a SET are not measured, so a value
  // that does not fit is refused when it arrives (abap.DBCFit) and one that
  // fits is bound right-trimmed as before.
  if (ct.k === "c" && (v.type.k === "string" || (v.type.k === "c" && (v.type.len ?? 1) > (ct.len ?? 1)))) {
    if (v.e === "chars" || v.e === "str") throw new Unsupported(`a literal longer than the ${ct.len ?? 1} characters of its column`);
    acc.hosts.push({fit: ct.len ?? 1, v});
    return RIR.param(`@@host:${acc.hosts.length - 1}@@`, ir);
  }
  const x = convert(v, ct);
  acc.hosts.push(x);
  return RIR.param(`@@host:${acc.hosts.length - 1}@@`, ir);
}

const SQL_OPS = {"=": "=", EQ: "=", "<>": "<>", NE: "<>", "<": "<", LT: "<", ">": ">", GT: ">", "<=": "<=", LE: "<=", ">=": ">=", GE: ">="};

/** one comparison of a WHERE: col op value, or col IN range (a hostPred) */
function sqlCompare(p, ctx, tb, acc) {
  const kids = p.getChildren();
  const text = p.concatTokens();
  if (!isExpr(kids[0], Expressions.SQLFieldName) || kids[0].concatTokens().includes("~")) throw new Unsupported(`WHERE compare: ${text}`);
  const col = upper(kids[0].concatTokens());
  const ct = tb.colType(col);
  const inn = p.findDirectExpression(Expressions.SQLIn);
  if (inn) {
    if (kids.length !== 2 || kids[1] !== inn) throw new Unsupported(`WHERE IN form: ${text}`);
    const srcs = inn.findDirectExpressions(Expressions.SQLSource);
    if (srcs.length !== 1 || inn.getChildren().length !== 2) throw new Unsupported(`WHERE IN form: ${text}`);
    const range = sqlHost(srcs[0], [], ctx, text);
    if (range.type.k !== "table" || range.type.row.k !== "struct") throw new Unsupported(`IN of a ${range.type.k}`);
    const fields = new Map((ctx.program.structs.get(range.type.row.go)?.fields ?? []).map((x) => [String(x.name).toUpperCase(), x]));
    if (!["SIGN", "OPTION", "LOW", "HIGH"].every((x) => fields.has(x))) throw new Unsupported(`IN of a table that is not a ranges table`);
    for (const f of ["LOW", "HIGH"]) {
      if (!["c", "string", "i", "n", "d", "t"].includes(fields.get(f).type.k)) throw new Unsupported(`IN: a range whose ${f} is a ${fields.get(f).type.k}`);
    }
    if (!["c", "string", "i", "n", "t"].includes(ct.k)) throw new Unsupported(`IN on a ${ct.k} column: ${text}`);
    // a d column: tools/ir-ranges.mjs refuses dates, so every range with a
    // row would be NOT_COMPILED at run time; refused here until it does
    const id = String(acc.ranges.length);
    const low = fields.get("LOW").type;
    const kind = ct.k === "n" ? "NUMC" : undefined;
    const irT = sqlIrType(ct);
    acc.ranges.push({id, column: lowName(col), type: irT, kind, lowLen: low.k === "c" || low.k === "n" ? low.len ?? 0 : 0, range});
    return rangeHostPred(id, lowName(col), irT, kind === undefined ? {} : {kind});
  }
  const op = p.findDirectExpression(Expressions.SQLCompareOperator);
  const src = p.findDirectExpression(Expressions.SQLSource);
  if (!op || !src || kids[1] !== op || kids[2] !== src) throw new Unsupported(`WHERE compare: ${text}`);
  const sqlOp = SQL_OPS[upper(op.concatTokens())];
  if (sqlOp === undefined) throw new Unsupported(`WHERE operator ${op.concatTokens()}`);
  if (!["c", "string", "i", "n", "d", "t", "int8"].includes(ct.k)) throw new Unsupported(`WHERE on a ${ct.k} column: ${text}`);
  const v = sqlHost(src, kids.slice(3), ctx, text);
  return RIR.bin(sqlOp, RIR.col(lowName(col), sqlIrType(ct)), sqlValue(v, ct, sqlIrType(ct), acc), RIR.T.bool);
}

/** a WHERE (SQLCond) as an IR predicate: comparisons, IN range, AND, OR,
 * NOT and parentheses, with ABAP's precedence (NOT, AND, OR) */
function sqlCond(node, ctx, tb, acc) {
  const items = node.getChildren();
  let i = 0;
  const text = node.concatTokens();
  const primary = () => {
    const n = items[i++];
    if (isTok(n, "(")) {
      const inner = items[i++];
      if (!isExpr(inner, Expressions.SQLCond) || !isTok(items[i], ")")) throw new Unsupported(`WHERE form: ${text}`);
      i += 1;
      return sqlCond(inner, ctx, tb, acc);
    }
    if (isExpr(n, Expressions.SQLCompare)) return sqlCompare(n, ctx, tb, acc);
    throw new Unsupported(`WHERE form: ${text}`);
  };
  const notExpr = () => {
    if (isTok(items[i], "NOT")) { i += 1; return RIR.not(notExpr()); }
    return primary();
  };
  const andExpr = () => {
    let l = notExpr();
    while (isTok(items[i], "AND")) { i += 1; l = RIR.bin("AND", l, notExpr(), RIR.T.bool); }
    return l;
  };
  let l = andExpr();
  while (isTok(items[i], "OR")) { i += 1; l = RIR.bin("OR", l, andExpr(), RIR.T.bool); }
  if (i !== items.length) throw new Unsupported(`WHERE form: ${text}`);
  return l;
}

/** the client and the WHERE of a statement, AND'ed */
function wherePred(node, ctx, tb, acc) {
  const cond = node.findDirectExpression(Expressions.SQLCond);
  let pred = tb.client ? mandtPred() : null;
  if (cond) pred = andIr(pred, sqlCond(cond, ctx, tb, acc));
  return pred;
}

/** a lowered statement's parameters as the emitter binds them, and its ranges */
function loweredArgs(lowered, acc) {
  const args = lowered.params.map((p) => {
    const m = /^@@host:(\d+)@@$/.exec(String(p.name ?? ""));
    if (m) {
      const h = acc.hosts[Number(m[1])];
      return h.fit !== undefined ? {host: h.v, fit: h.fit} : {host: h};
    }
    if (p.name === "SY-MANDT") return {mandt: true};
    return {value: p.value};
  });
  const preds = (lowered.hostPreds ?? []).map((h) => ({...acc.ranges[Number(h.id)], after: h.after}));
  return {args, preds};
}

function lowerOrRefuse(verb, rel) {
  try { return lowerRelation(rel, "sqlite"); } catch (e) { throw new Unsupported(`${verb}: the relational IR refused it: ${e.message}`); }
}

/** the field list of a SELECT: * or plain columns */
function selectColumns(sel, tb, text) {
  const fl = sel.findDirectExpression(Expressions.SQLFieldList);
  const names = /^\s*\*\s*$/.test(fl?.concatTokens() ?? "") ? [...tb.columns.keys()]
    : (fl?.findAllExpressions(Expressions.SQLField) ?? []).map((f) => {
      const n = f.findDirectExpression(Expressions.SQLFieldName);
      if (!n || f.getChildren().length !== 1) throw new Unsupported(`SELECT field ${f.concatTokens()}`);
      return upper(n.concatTokens());
    });
  if (names.length === 0) throw new Unsupported(`SELECT field list: ${text}`);
  return names.map((n) => ({name: n, type: tb.colType(n)}));
}

/*
 * ultra/itab: SELECT c ... COUNT( * ) [AS a] MAX( c ) AS a ... GROUP BY c ...
 * (A4H 2026-09-24, ZCL_GOGEN_T_GRPBY): plain columns, each one of the GROUP
 * BY list, and COUNT( * ), MAX / MIN of a column (its own type) and SUM of
 * an i column; the result named by AS (the CORRESPONDING name). An
 * aggregate without GROUP BY reads NULL over no rows, which a scan into a
 * field does not take: refused, as are AVG, COUNT( col ), DISTINCT inside
 * and SUM of other types (not measured).
 */
function groupedColumns(sel, tb, text) {
  const gb = sel.findDirectExpression(Expressions.SQLGroupBy);
  if (!gb) throw new Unsupported(`SELECT with an aggregate and no GROUP BY: ${text}`);
  // the first column is an SQLField, the ones after it bare SQLFieldNames
  const gcols = gb.getChildren().filter((c) => !isTok(c, "GROUP") && !isTok(c, "BY") && !isTok(c, ","));
  const groupBy = gcols.map((f) => {
    const n = isExpr(f, Expressions.SQLFieldName) ? f : f.findDirectExpression(Expressions.SQLFieldName);
    if (!n || (!isExpr(f, Expressions.SQLFieldName) && f.getChildren().length !== 1)) throw new Unsupported(`GROUP BY ${f.concatTokens()}`);
    const name = upper(n.concatTokens());
    tb.colType(name);
    return name;
  });
  if (groupBy.length === 0) throw new Unsupported(`GROUP BY form: ${text}`);
  const fl = sel.findDirectExpression(Expressions.SQLFieldList);
  const cols = [];
  for (const f of fl?.findDirectExpressions(Expressions.SQLField) ?? []) {
    const agg = f.findDirectExpression(Expressions.SQLAggregation);
    const as = f.findDirectExpression(Expressions.SQLAsName);
    if (!agg) {
      const n = f.findDirectExpression(Expressions.SQLFieldName);
      if (!n || f.getChildren().length !== 1) throw new Unsupported(`SELECT field ${f.concatTokens()}`);
      const name = upper(n.concatTokens());
      if (!groupBy.includes(name)) throw new Unsupported(`SELECT field ${name} is not in GROUP BY: ${text}`);
      cols.push({name, type: tb.colType(name)});
      continue;
    }
    const fn = upper(agg.getFirstToken().getStr());
    const name = as ? upper(as.concatTokens()) : null;
    if (/\bDISTINCT\b/i.test(agg.concatTokens())) throw new Unsupported(`aggregate ${agg.concatTokens()}`);
    if (fn === "COUNT" && /^COUNT\s*\(\s*\*\s*\)$/i.test(agg.concatTokens())) {
      cols.push({name: name ?? "COUNT_STAR", type: I, agg: {star: true}, named: !!name});
      continue;
    }
    const n = agg.findFirstExpression(Expressions.SQLFieldName);
    if (!n || !["MAX", "MIN", "SUM"].includes(fn)) throw new Unsupported(`aggregate ${agg.concatTokens()}`);
    const col = upper(n.concatTokens());
    const ct = tb.colType(col);
    if (fn === "SUM" && ct.k !== "i") throw new Unsupported(`SUM of a ${ct.k} column: not measured`);
    if (fn !== "SUM" && !["c", "i", "n", "d", "t", "string"].includes(ct.k)) throw new Unsupported(`${fn} of a ${ct.k} column`);
    cols.push({name: name ?? `${fn}_${col}`, type: ct, agg: {fn, col}, named: !!name});
  }
  if (cols.length === 0) throw new Unsupported(`SELECT field list: ${text}`);
  if (new Set(cols.map((c) => c.name)).size !== cols.length) throw new Unsupported(`SELECT: two results of one name: ${text}`);
  cols.grouped = true;
  cols.groupBy = groupBy;
  return cols;
}

function selectTable(sel, ctx, text) {
  const from = sel.findDirectExpression(Expressions.SQLFrom)?.findAllExpressions(Expressions.DatabaseTable) ?? [];
  if (from.length !== 1) throw new Unsupported(`SELECT FROM form: ${text}`);
  return dbTable(ctx, upper(from[0].concatTokens()), "SELECT FROM");
}

/** ORDER BY f [ASCENDING|DESCENDING] ..., by columns of the table */
function orderByOf(sel, tb) {
  const order = [];
  const ob = sel.findDirectExpression(Expressions.SQLOrderBy);
  if (ob) {
    if (/PRIMARY\s+KEY/i.test(ob.concatTokens())) throw new Unsupported("ORDER BY PRIMARY KEY");
    const kids = ob.getChildren().filter((c) => !isTok(c, "ORDER") && !isTok(c, "BY") && !isTok(c, ","));
    for (let i = 0; i < kids.length; i += 1) {
      if (!isExpr(kids[i], Expressions.SQLField)) throw new Unsupported(`ORDER BY form: ${ob.concatTokens()}`);
      // the column before its direction (read after the step, it was the
      // DESCENDING token itself: "no column DESCENDING")
      const col = upper(kids[i].concatTokens());
      const desc = isTok(kids[i + 1], "DESCENDING");
      if (isTok(kids[i + 1], "DESCENDING") || isTok(kids[i + 1], "ASCENDING")) i += 1;
      tb.colType(col);
      order.push({col, desc});
    }
  }
  return order;
}

/*
 * SELECT ... INTO wa ... ENDSELECT, a loop over the rows. Measured on A4H
 * 2026-09-24 (ZCL_GOGEN_T_SELLOOP in $ZOSG_TMP_0195, over T000 of two rows:
 * "n:2 in:1/0,2/0, after:0/2 exit:0/1/000 exitmiss:0/1 none:4/0/QQQ
 * cont:0/2/2 corr:5/000 elem:000/2 exit2:0/2"): each pass starts with
 * sy-subrc 0 and sy-dbcnt the rows read so far, whatever the body did on
 * the pass before; after ENDSELECT, or after an EXIT out of the loop,
 * sy-subrc is 0 and sy-dbcnt the rows read when there was a row (a sy-subrc
 * the body left is overwritten), 4 and 0 when there was none, and the work
 * area keeps what it had. The rows are read before the first pass (the
 * transpiler does the same); what a system's cursor shows of a write to the
 * same table inside the loop is not measured, so such a body is refused.
 */
function selectLoop(node, ctx) {
  const st = node.findDirectStatement(Statements.SelectLoop);
  const text = st?.concatTokens() ?? "";
  const sel = st?.findDirectExpression(Expressions.Select);
  if (!sel || /\b(SINGLE|UP\s+TO|DISTINCT|GROUP|HAVING|JOIN|FOR\s+ALL|APPENDING|PACKAGE|BYPASSING|CLIENT|UNION|FOR\s+UPDATE)\b/i.test(text)) throw new Unsupported(`SELECT loop form: ${text}`);
  if (sel.findDirectExpression(Expressions.SQLIntoTable)) throw new Unsupported(`SELECT loop INTO TABLE: ${text}`);
  const tb = selectTable(sel, ctx, text);
  const cols = selectColumns(sel, tb, text);
  const {assign, target} = intoWorkArea(sel, ctx, text, cols, "SELECT loop");
  const acc = {hosts: [], ranges: []};
  const pred = wherePred(sel, ctx, tb, acc);
  const order = orderByOf(sel, tb);
  let rel = RIR.scan(lowName(tb.name));
  if (pred !== null) rel = RIR.filter(rel, pred);
  rel = RIR.project(rel, cols.map((c) => ({as: lowName(c.name), expr: RIR.col(lowName(c.name), sqlIrType(c.type))})));
  if (order.length > 0) rel = RIR.order(rel, order.map((o) => ({col: lowName(o.col), desc: o.desc})));
  const lowered = lowerOrRefuse("SELECT", rel);
  const body = bodyOf(node, ctx);
  // a write to the table being read, inside the loop: refused (see above)
  const writes = [];
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    if ((n.s === "db_write" || n.s === "db_write_sql") && n.table === tb.name) writes.push(n);
    for (const k of Object.keys(n)) if (k !== "type") walk(n[k]);
  };
  walk(body);
  if (writes.length > 0) throw new Unsupported(`SELECT loop over ${tb.name} that writes ${tb.name}: what the cursor sees of it is not measured`);
  return {s: "select_loop", table: tb.name, cols, assign, target, sql: lowered.sql, ...loweredArgs(lowered, acc), body};
}

/**
 * SELECT fields FROM table INTO [CORRESPONDING FIELDS OF] TABLE itab
 * [WHERE ...] [ORDER BY f ...]: the form the gateway's DPCs use. sy-subrc 0
 * with rows, 4 without; sy-dbcnt the rows.
 */
function selectStatement(node, ctx, text) {
  const sel = node.findDirectExpression(Expressions.Select);
  if (sel && isDynamicSelect(sel)) return dynamicSelect(sel, ctx, text);
  if (sel && /^SELECT\s+SINGLE\b/i.test(text)) return selectSingle(sel, ctx, text);
  if (sel && /^SELECT\s+COUNT\s*\(\s*\*\s*\)\s+FROM\b/i.test(text)) return selectCount(sel, ctx, text);
  if (!sel || /\b(SINGLE|UP\s+TO|DISTINCT|HAVING|JOIN|FOR\s+ALL|APPENDING|PACKAGE|BYPASSING|CLIENT|UNION)\b/i.test(text)) throw new Unsupported(`SELECT form: ${text}`);
  const tb = selectTable(sel, ctx, text);
  // ultra/itab: aggregates and GROUP BY (groupedColumns below)
  const grouped = sel.findDirectExpression(Expressions.SQLGroupBy) !== undefined && sel.findDirectExpression(Expressions.SQLGroupBy) !== null;
  const cols = grouped || sel.findFirstExpression(Expressions.SQLAggregation) ? groupedColumns(sel, tb, text) : selectColumns(sel, tb, text);
  const into = sel.findDirectExpression(Expressions.SQLIntoTable);
  if (!into) throw new Unsupported(`SELECT INTO form (only INTO [CORRESPONDING FIELDS OF] TABLE): ${text}`);
  const corresponding = /\bCORRESPONDING\s+FIELDS\b/i.test(into.concatTokens());
  // ultra/itab (critic fix): an aggregate without AS has no name of its
  // own (COUNT_STAR / MAX_ID are ours), so INTO CORRESPONDING FIELDS would
  // drop it silently; what ABAP does there is not measured. By position it
  // was measured (ZCL_GOGEN_T_GRPBY) and stays.
  if (corresponding && cols.some((c) => c.agg && !c.named)) throw new Unsupported(`SELECT aggregate without AS INTO CORRESPONDING FIELDS: not measured: ${text}`);
  const target = lvalue(into.findFirstExpression(Expressions.Target), ctx);
  if (target.type.k !== "table") throw new Unsupported(`SELECT INTO TABLE of a ${target.type.k}`);
  const elementary = target.type.row.k !== "struct";
  if (elementary && (corresponding || cols.length !== 1 || !["c", "string", "i"].includes(target.type.row.k))) throw new Unsupported(`SELECT INTO TABLE of ${target.type.row.k} rows: ${text}`);
  const rowFields = new Map((ctx.program.structs.get(target.type.row.go)?.fields ?? []).map((f) => [String(f.name).toUpperCase(), f]));
  const rowOrder = ctx.program.structs.get(target.type.row.go)?.fields ?? [];
  // where each column goes: by name for CORRESPONDING, else by position
  const assign = elementary ? [{line: true, type: target.type.row}] : cols.map((c, i) => {
    const f = corresponding ? rowFields.get(c.name) : rowOrder[i];
    if (!f) return null;
    // a DEC column into a p field, rounded to the field (abap.DBP)
    if ((c.type.k === "p") !== (f.type.k === "p")) throw new Unsupported(`SELECT: column ${c.name} (${c.type.k}) into ${f.name} (${f.type.k})`);
    if (c.type.k === "p") return {field: f.name, type: f.type};
    if (!["c", "string", "i", "d", "t", "n"].includes(c.type.k) || !["c", "string", "i", "d", "t"].includes(f.type.k)) throw new Unsupported(`SELECT: column ${c.name} (${c.type.k}) into ${f.name} (${f.type.k})`);
    if ((c.type.k === "i") !== (f.type.k === "i")) throw new Unsupported(`SELECT: column ${c.name} (${c.type.k}) into ${f.name} (${f.type.k})`);
    return {field: f.name, type: f.type};
  });
  const acc = {hosts: [], ranges: []};
  const pred = wherePred(sel, ctx, tb, acc);
  const order = orderByOf(sel, tb);
  let rel = RIR.scan(lowName(tb.name));
  if (pred !== null) rel = RIR.filter(rel, pred);
  if (cols.grouped) {
    // GROUP BY keys and aggregates, then a projection back into the order of
    // the field list: the rows are scanned by position
    const aggs = cols.filter((c) => c.agg).map((c) => ({as: lowName(c.name), expr: c.agg.star
      ? {...RIR.call("COUNT", [], RIR.T.int), star: true} : RIR.call(c.agg.fn, [RIR.col(lowName(c.agg.col), sqlIrType(c.type))], sqlIrType(c.type))}));
    rel = RIR.aggregate(rel, cols.groupBy.map(lowName), aggs);
    rel = RIR.project(rel, cols.map((c) => ({as: lowName(c.name), expr: RIR.col(lowName(c.name), sqlIrType(c.type))})));
  } else {
    rel = RIR.project(rel, cols.map((c) => ({as: lowName(c.name), expr: RIR.col(lowName(c.name), sqlIrType(c.type))})));
  }
  if (order.length > 0) rel = RIR.order(rel, order.map((o) => ({col: lowName(o.col), desc: o.desc})));
  const lowered = lowerOrRefuse("SELECT", rel);
  return {s: "select_table", table: tb.name, cols, assign, target, sql: lowered.sql, ...loweredArgs(lowered, acc)};
}

/** a SELECT with a part given at run time: FROM (name), a field list,
 * WHERE, GROUP BY or ORDER BY in parentheses */
function isDynamicSelect(sel) {
  const dyn = (n) => n?.findDirectExpression(Expressions.Dynamic) !== undefined && n?.findDirectExpression(Expressions.Dynamic) !== null;
  const tables = sel.findDirectExpression(Expressions.SQLFrom)?.findAllExpressions(Expressions.DatabaseTable) ?? [];
  const cond = sel.findDirectExpression(Expressions.SQLCond);
  return tables.some(dyn) || dyn(sel.findDirectExpression(Expressions.SQLFieldList))
    || (cond !== undefined && cond !== null && cond.findFirstExpression(Expressions.Dynamic) !== undefined && cond.findFirstExpression(Expressions.Dynamic) !== null)
    || dyn(sel.findDirectExpression(Expressions.SQLGroupBy)) || dyn(sel.findDirectExpression(Expressions.SQLOrderBy));
}

/** the operand of a dynamic token, (x): a string or c (one line of tokens)
 * or a table of them (the lines, one after the other) */
function dynamicTokens(dyn, ctx, what, text) {
  const fc = dyn.findFirstExpression(Expressions.FieldChain);
  if (!fc || dyn.getChildren().length !== 3) throw new Unsupported(`dynamic ${what}: ${text}`);
  const v = fieldChain(fc, ctx);
  if (["string", "c"].includes(v.type.k)) return v;
  if (v.type.k === "table" && ["string", "c"].includes(v.type.row.k)) return v;
  throw new Unsupported(`dynamic ${what} of a ${v.type.k === "table" ? `table of ${v.type.row.k}` : v.type.k}: ${text}`);
}

/**
 * Dynamic Open SQL: SELECT [*|(fields)|f ...] FROM <table>|(name) INTO
 * [CORRESPONDING FIELDS OF] TABLE <itab> [WHERE (cond)] [GROUP BY (g)]
 * [ORDER BY (o) | PRIMARY KEY | f ...], the form OSG's generated readers
 * (gen/cds zcl_stg_tab_* / zcl_stg_cds_*) and open-abap-odata's search-help
 * reader use. Nothing of it is known here but the shape: the runtime
 * (go/abap selectdyn.go) resolves the table in the registry, parses the
 * condition with the port of tools/ir-osql-where.mjs, adds the client and
 * fills the table through its descriptor.
 */
function dynamicSelect(sel, ctx, text) {
  if (/^SELECT\s+SINGLE\b/i.test(text)) throw new Unsupported(`dynamic SELECT SINGLE: ${text}`);
  if (/\b(UP\s+TO|DISTINCT|HAVING|JOIN|FOR\s+ALL|APPENDING|PACKAGE|BYPASSING|CLIENT|UNION|CONNECTION|OFFSET)\b/i.test(text)) throw new Unsupported(`dynamic SELECT form: ${text}`);
  const from = sel.findDirectExpression(Expressions.SQLFrom)?.findAllExpressions(Expressions.DatabaseTable) ?? [];
  if (from.length !== 1) throw new Unsupported(`dynamic SELECT FROM form: ${text}`);
  let table;
  const tdyn = from[0].findDirectExpression(Expressions.Dynamic);
  if (tdyn) {
    const v = dynamicTokens(tdyn, ctx, "FROM", text);
    if (v.type.k === "table") throw new Unsupported(`FROM of a table of names: ${text}`);
    table = convert(v, S);
  } else {
    const name = upper(from[0].concatTokens());
    // a table or view of the dictionary, and not a view that hides the
    // client (refused here as a static read is; by name it is refused when
    // it arrives)
    dbTable(ctx, name, "SELECT FROM");
    table = {e: "str", value: name, type: S};
  }
  // the field list: * (null), (x), or plain column names
  const fl = sel.findDirectExpression(Expressions.SQLFieldList);
  let fields = null;
  const fdyn = fl?.findDirectExpression(Expressions.Dynamic);
  if (fdyn) fields = dynamicTokens(fdyn, ctx, "field list", text);
  else if (!/^\s*\*\s*$/.test(fl?.concatTokens() ?? "")) {
    const names = (fl?.findAllExpressions(Expressions.SQLField) ?? []).map((f) => {
      const n = f.findDirectExpression(Expressions.SQLFieldName);
      if (!n || f.getChildren().length !== 1) throw new Unsupported(`SELECT field ${f.concatTokens()}`);
      return upper(n.concatTokens());
    });
    if (names.length === 0) throw new Unsupported(`SELECT field list: ${text}`);
    fields = {e: "strlist", values: names};
  }
  // WHERE (x) alone: a static condition over a table named at run time has
  // no columns to be typed against here
  const cond = sel.findDirectExpression(Expressions.SQLCond);
  let where = null;
  if (cond) {
    const kids = cond.getChildren();
    const cmp = kids.length === 1 && isExpr(kids[0], Expressions.SQLCompare) ? kids[0] : undefined;
    const wdyn = cmp && cmp.getChildren().length === 1 && isExpr(cmp.getFirstChild(), Expressions.Dynamic) ? cmp.getFirstChild() : undefined;
    if (!wdyn) throw new Unsupported(`a WHERE that is not one (condition) in a dynamic SELECT: ${text}`);
    where = dynamicTokens(wdyn, ctx, "WHERE", text);
    if (where.type.k === "table") throw new Unsupported(`WHERE of a table of lines (how the lines join is not measured): ${text}`);
    where = convert(where, S);
  }
  const listOf = (node, what) => {
    if (!node) return null;
    const d = node.findDirectExpression(Expressions.Dynamic);
    if (d) return dynamicTokens(d, ctx, what, text);
    const kids = node.getChildren().filter((c) => !isTok(c, "ORDER") && !isTok(c, "GROUP") && !isTok(c, "BY") && !isTok(c, ","));
    const out = [];
    for (const k of kids) {
      if (isTok(k, "ASCENDING") || isTok(k, "DESCENDING")) { out.push(upper(k.concatTokens())); continue; }
      if (!isExpr(k, Expressions.SQLField) && !isExpr(k, Expressions.SQLFieldName)) throw new Unsupported(`${what} form: ${node.concatTokens()}`);
      out.push(upper(k.concatTokens()));
    }
    return {e: "strlist", values: out};
  };
  const groupBy = listOf(sel.findDirectExpression(Expressions.SQLGroupBy), "GROUP BY");
  const ob = sel.findDirectExpression(Expressions.SQLOrderBy);
  const primaryKey = ob !== undefined && ob !== null && /^ORDER\s+BY\s+PRIMARY\s+KEY$/i.test(ob.concatTokens());
  const orderBy = primaryKey ? null : listOf(ob, "ORDER BY");
  const into = sel.findDirectExpression(Expressions.SQLIntoTable);
  if (!into) throw new Unsupported(`dynamic SELECT INTO form (only INTO [CORRESPONDING FIELDS OF] TABLE): ${text}`);
  const corresponding = /\bCORRESPONDING\s+FIELDS\b/i.test(into.concatTokens());
  let target = lvalue(into.findFirstExpression(Expressions.Target), ctx);
  if (target.type.k === "table") target = convert(target, {k: "data", table: true});
  else if (target.type.k !== "data") throw new Unsupported(`dynamic SELECT INTO TABLE of a ${target.type.k}`);
  return {s: "select_dyn", table, fields, where, groupBy, orderBy, primaryKey, corresponding, target, text: text.replace(/\s+/g, " ")};
}

/**
 * SELECT COUNT(*) FROM table INTO n [WHERE ...]: the count into n, sy-dbcnt
 * the count (A4H, ANORMALIES select-count-dbcnt), sy-subrc 4 when it is 0.
 */
function selectCount(sel, ctx, text) {
  if (/\b(SINGLE|UP\s+TO|DISTINCT|GROUP|HAVING|JOIN|FOR\s+ALL|APPENDING|PACKAGE|BYPASSING|CLIENT|UNION|ORDER\s+BY|TABLE)\b/i.test(text)) throw new Unsupported(`SELECT COUNT form: ${text}`);
  const fl = sel.findDirectExpression(Expressions.SQLFieldList);
  if (!/^COUNT\s*\(\s*\*\s*\)$/i.test(fl?.concatTokens() ?? "")) throw new Unsupported(`SELECT COUNT form: ${text}`);
  const tb = selectTable(sel, ctx, text);
  const into = sel.findDirectExpression(Expressions.SQLIntoStructure);
  const tnode = into?.findDirectExpression(Expressions.SQLTarget)?.findDirectExpression(Expressions.Target);
  if (!into || !tnode || into.findDirectExpressions(Expressions.SQLTarget).length !== 1) throw new Unsupported(`SELECT COUNT INTO form: ${text}`);
  const target = lvalue(tnode, ctx);
  if (target.type.k !== "i") throw new Unsupported(`SELECT COUNT INTO a ${target.type.k}: ${text}`);
  const acc = {hosts: [], ranges: []};
  const pred = wherePred(sel, ctx, tb, acc);
  let rel = RIR.scan(lowName(tb.name));
  if (pred !== null) rel = RIR.filter(rel, pred);
  rel = RIR.aggregate(rel, [], [{as: "n", expr: {...RIR.call("COUNT", [], RIR.T.int), star: true}}]);
  const lowered = lowerOrRefuse("SELECT COUNT", rel);
  return {s: "select_count", table: tb.name, target, sql: lowered.sql, ...loweredArgs(lowered, acc)};
}

/**
 * COMMIT WORK [AND WAIT] / ROLLBACK WORK: the database LUW of the host
 * (go/abap/luw.go). sy-subrc 0, sy-dbcnt untouched (A4H). Nothing else is
 * registered for a COMMIT to run: PERFORM ON COMMIT and CALL FUNCTION IN
 * UPDATE TASK do not compile. COMMIT/ROLLBACK CONNECTION is another
 * database connection, which the host does not have.
 */
function luwStatement(node, text) {
  if (!/^(COMMIT\s+WORK(\s+AND\s+WAIT)?|ROLLBACK\s+WORK)\s*\.?$/i.test(text)) throw new Unsupported(`LUW form: ${text}`);
  return {s: isStmt(node, Statements.Commit) ? "commit_work" : "rollback_work"};
}

/**
 * INSERT / UPDATE / MODIFY / DELETE on a database table, through the write
 * nodes of the relational IR (tools/ir-writes.mjs). What each does was
 * measured on A4H (testdata/zcl_gogen_t_dbw, ANORMALIES dbwrite-*):
 *   INSERT FROM wa         sy-subrc 4 and nothing written for a duplicate key
 *   INSERT FROM TABLE      every row without a duplicate written, then
 *                          CX_SY_OPEN_SQL_DB with sy untouched ("raise")
 *   ... ACCEPTING DUPLICATE KEYS  sy-subrc 4, sy-dbcnt the rows written
 *   UPDATE / DELETE FROM wa / TABLE   by the primary key, one row at a time,
 *                          the counts summed, sy-subrc 4 when a row is missing
 *   UPDATE SET / DELETE WHERE   sy-subrc 4 when no row, sy-dbcnt the rows
 *   MODIFY                 insert or update, sy-subrc 0
 * MANDT is the logon client whatever the work area holds.
 */
function dbWriteStatement(kind, node, ctx, text) {
  const verb = text.split(/\s+/)[0].toUpperCase();
  const name = upper((node.findFirstExpression(Expressions.DatabaseTable) ?? node.findFirstExpression(Expressions.Target))?.concatTokens() ?? "");
  if (/\b(CLIENT|CONNECTION|USING)\b/i.test(text)) throw new Unsupported(`${verb} form: ${text}`);
  // a name that is a variable is the internal table's, as ABAP resolves it
  if (isVariableName(name, ctx)) throw new Unsupported(`${verb} ${name}: an internal table named like a table of the dictionary`);
  const tb = dbTable(ctx, name, verb);
  if (kind === "update" && isStmt(node, Statements.UpdateDatabase) && /^UPDATE\s+\S+\s+SET\b/i.test(text)) return updateSet(node, ctx, tb, text);
  if (kind === "delete" && /^DELETE\s+FROM\b/i.test(text)) return deleteWhere(node, ctx, tb, text);
  return writeRows(kind, node, ctx, tb, text, verb);
}

/** UPDATE dbtab SET col = value ... [WHERE ...], lowered here */
function updateSet(node, ctx, tb, text) {
  const acc = {hosts: [], ranges: []};
  const set = [];
  const kids = node.getChildren();
  const at = kids.findIndex((k) => isTok(k, "SET"));
  for (let i = at + 1; i < kids.length && !isTok(kids[i], "WHERE") && !isTok(kids[i], "."); i += 1) {
    const k = kids[i];
    if (isTok(k, ",")) continue;
    if (!isExpr(k, Expressions.SQLFieldAndValue)) throw new Unsupported(`UPDATE SET form: ${text}`);
    const fk = k.getChildren();
    const src = k.findDirectExpression(Expressions.SQLSource);
    if (!isExpr(fk[0], Expressions.SQLFieldName) || !isTok(fk[1], "=") || fk[2] !== src) throw new Unsupported(`UPDATE SET form: ${k.concatTokens()}`);
    const col = upper(fk[0].concatTokens());
    if (tb.client && col === "MANDT") throw new Unsupported(`UPDATE SET of the client column: ${text}`);
    const ct = tb.colType(col);
    const ir = writeIrType(ct, `UPDATE ${tb.name}-${col}`);
    set.push({col, expr: sqlValue(sqlHost(src, fk.slice(3), ctx, k.concatTokens()), ct, ir, acc)});
  }
  if (set.length === 0) throw new Unsupported(`UPDATE SET form: ${text}`);
  const pred = wherePred(node, ctx, tb, acc);
  let stmt;
  try { stmt = WIR.update(tb.name, set, pred ?? undefined); } catch (e) { throw new Unsupported(`UPDATE ${tb.name}: ${e.message}`); }
  const lowered = lowerOrRefuse(`UPDATE ${tb.name}`, stmt);
  return {s: "db_write_sql", verb: "UPDATE", table: tb.name, sql: lowered.sql, ...loweredArgs(lowered, acc)};
}

/** DELETE FROM dbtab [WHERE ...], lowered here */
function deleteWhere(node, ctx, tb, text) {
  if (!isStmt(node, Statements.DeleteDatabase)) throw new Unsupported(`DELETE form: ${text}`);
  const acc = {hosts: [], ranges: []};
  const pred = wherePred(node, ctx, tb, acc);
  const lowered = lowerOrRefuse(`DELETE ${tb.name}`, WIR.remove(tb.name, pred ?? undefined));
  return {s: "db_write_sql", verb: "DELETE", table: tb.name, sql: lowered.sql, ...loweredArgs(lowered, acc)};
}

/** INSERT / UPDATE / MODIFY / DELETE dbtab FROM wa | FROM TABLE itab, INSERT INTO dbtab VALUES wa */
function writeRows(kind, node, ctx, tb, text, verb) {
  const fromTable = /\bFROM\s+TABLE\b/i.test(text);
  const accepting = /\bACCEPTING\s+DUPLICATE\s+KEYS\b/i.test(text);
  if (accepting && (kind !== "insert" || !fromTable)) throw new Unsupported(`${verb} form: ${text}`);
  let value;
  if (isStmt(node, Statements.DeleteInternal)) {
    const src = node.findDirectExpression(Expressions.Source);
    if (!src || !/^DELETE\s+\S+\s+FROM\s+[^\s.]+\s*\.?$/i.test(text)) throw new Unsupported(`DELETE form: ${text}`);
    value = source(src, ctx);
  } else {
    const src = node.findDirectExpression(Expressions.SQLSource) ?? node.findDirectExpression(Expressions.SQLSourceSimple);
    const ok = kind === "insert" ? /^INSERT\s+(INTO\s+\S+\s+VALUES|\S+\s+FROM(\s+TABLE)?)\s+\S+(\s+ACCEPTING\s+DUPLICATE\s+KEYS)?\s*\.?$/i
      : new RegExp(`^${verb}\\s+\\S+\\s+FROM(\\s+TABLE)?\\s+\\S+\\s*\\.?$`, "i");
    if (!src || !ok.test(text)) throw new Unsupported(`${verb} form: ${text}`);
    value = sqlHost(src, [], ctx, text);
  }
  const row = fromTable ? (value.type.k === "table" ? value.type.row : null) : value.type;
  if (row === null) throw new Unsupported(`${verb} ... FROM TABLE of a ${value.type.k}`);
  if (row.k !== "struct") throw new Unsupported(`${verb} ${tb.name} FROM a ${row.k}: a work area of the table's line type is needed`);
  // the work area has the table's columns, in order, of the same kind and
  // length: a move by name and by layout are then the same
  const fields = ctx.program.structs.get(row.go)?.fields ?? [];
  const names = [...tb.columns.keys()];
  if (fields.length !== names.length || names.some((n, i) => {
    const ct = tb.colType(n);
    const f = fields[i];
    return f.name !== n || f.type.k !== ct.k || (f.type.len ?? null) !== (ct.len ?? null);
  })) throw new Unsupported(`${verb} ${tb.name}: a work area not of the table's line type (${row.go})`);
  const cols = names.map((n) => {
    const ct = tb.colType(n);
    return {name: n, kind: ct.k, ir: writeIrType(ct, `${verb} ${tb.name}-${n}`), client: tb.client && n === "MANDT"};
  });
  if (tb.key.length === 0 || tb.key.some((k) => !tb.columns.has(k))) throw new Unsupported(`${verb} ${tb.name}: its primary key does not resolve`);
  const schema = Object.fromEntries(cols.map((c) => [c.name, c.ir]));
  const rows = WIR.bindRows(names, schema, [{}]);
  const keyPred = cols.filter((c) => tb.key.includes(c.name)).map((c) => RIR.bin("=", RIR.col(c.name, c.ir), WIR.initialValue(c.ir), RIR.T.bool))
    .reduce((a, b) => RIR.bin("AND", a, b, RIR.T.bool));
  const rest = cols.filter((c) => !tb.key.includes(c.name));
  const op = kind === "merge" ? "modify" : kind;
  if (op === "modify" && rest.length === 0) throw new Unsupported(`MODIFY ${tb.name}: every column is a key column, and what sy-dbcnt says for an existing row is not measured`);
  // the statement as the IR has it, lowered once here so that what the IR
  // refuses is refused at build time; the Go runtime renders the same
  // shape with the rows it is given (go/abap/irsql.go, writes.json)
  const onDuplicate = op !== "insert" ? undefined : accepting ? "ignore" : fromTable ? "raise" : "error";
  try {
    const stmt = op === "insert" ? WIR.insertRows(tb.name, names, rows, {onDuplicate})
      : op === "update" ? WIR.update(tb.name, rest.map((c) => ({col: c.name, expr: WIR.initialValue(c.ir)})), keyPred)
        : op === "delete" ? WIR.remove(tb.name, keyPred)
          : WIR.upsert(tb.name, names, rows, tb.key);
    lowerRelation(stmt, "sqlite");
  } catch (e) {
    throw new Unsupported(`${verb} ${tb.name}: the relational IR refused it: ${e.message}`);
  }
  return {s: "db_write", op, table: tb.name, value, fromTable, onDuplicate, cols, key: tb.key};
}

/**
 * The INTO of SELECT SINGLE and of a SELECT loop: one work area, or one
 * elementary field for one column. Only the fields the columns go to are
 * written (by name with CORRESPONDING, else by position).
 */
function intoWorkArea(sel, ctx, text, cols, verb) {
  const into = sel.findDirectExpression(Expressions.SQLIntoStructure);
  const tnode = into?.findDirectExpression(Expressions.SQLTarget)?.findDirectExpression(Expressions.Target);
  if (!into || !tnode || into.findDirectExpressions(Expressions.SQLTarget).length !== 1) throw new Unsupported(`${verb} INTO form: ${text}`);
  const corresponding = /\bCORRESPONDING\s+FIELDS\b/i.test(into.concatTokens());
  const target = lvalue(tnode, ctx);
  // a raw column (RAWSTRING) holds its bytes as hex text, the transpiler's
  // storage: it goes into an xstring field only
  const okCol = (c, f) => (c.type.k === "xstring" && f.type.k === "xstring") || (c.type.k === "p" && f.type.k === "p")
    || (["c", "string", "i", "d", "t", "n"].includes(c.type.k) && ["c", "string", "i", "d", "t"].includes(f.type.k) && (c.type.k === "i") === (f.type.k === "i"));
  let assign;
  if (target.type.k === "struct") {
    const fields = ctx.program.structs.get(target.type.go)?.fields ?? [];
    const byName = new Map(fields.map((f) => [String(f.name).toUpperCase(), f]));
    assign = cols.map((c, i) => {
      const f = corresponding ? byName.get(c.name) : fields[i];
      if (!f && !corresponding) throw new Unsupported(`SELECT without CORRESPONDING: more columns than ${target.type.go} has fields`);
      if (!f) return null;
      if (!okCol(c, f)) throw new Unsupported(`SELECT: column ${c.name} (${c.type.k}) into ${f.name} (${f.type.k})`);
      // by position the move is by flat layout on a system: equal only while
      // each column has its field's type and length
      if (!corresponding && (c.type.k !== f.type.k || (c.type.len ?? null) !== (f.type.len ?? null) || (c.type.dec ?? null) !== (f.type.dec ?? null))) {
        throw new Unsupported(`SELECT without CORRESPONDING: column ${c.name} (${c.type.k}${c.type.len ?? ""}) into ${f.name} (${f.type.k}${f.type.len ?? ""}) is a layout move`);
      }
      return {field: f.name, type: f.type};
    });
  } else {
    if (corresponding || cols.length !== 1 || !okCol(cols[0], target)) throw new Unsupported(`${verb} INTO a ${target.type.k}: ${text}`);
    assign = [{line: true, type: target.type}];
  }
  return {assign, target};
}

/**
 * SELECT SINGLE fields FROM table INTO [CORRESPONDING FIELDS OF] wa
 * [WHERE ...]. Measured on A4H (2026-09-23): without a row, sy-subrc is 4
 * and the target keeps what it had; with one, only the fields the columns
 * go to are written (by name with CORRESPONDING, else by position), the
 * others keep theirs. A host value is converted to the column's type and
 * bound; MANDT is the logon client, as for a table.
 */
function selectSingle(sel, ctx, text) {
  if (/\b(UP\s+TO|DISTINCT|GROUP|HAVING|JOIN|FOR\s+ALL|APPENDING|PACKAGE|BYPASSING|CLIENT|UNION|ORDER\s+BY|FOR\s+UPDATE)\b/i.test(text)) throw new Unsupported(`SELECT form: ${text}`);
  const tb = selectTable(sel, ctx, text);
  const cols = selectColumns(sel, tb, text);
  const {assign, target} = intoWorkArea(sel, ctx, text, cols, "SELECT SINGLE");
  const acc = {hosts: [], ranges: []};
  const pred = wherePred(sel, ctx, tb, acc);
  let rel = RIR.scan(lowName(tb.name));
  if (pred !== null) rel = RIR.filter(rel, pred);
  rel = RIR.project(rel, cols.map((c) => ({as: lowName(c.name), expr: RIR.col(lowName(c.name), sqlIrType(c.type))})));
  rel = RIR.limit(rel, 1);
  const lowered = lowerOrRefuse("SELECT", rel);
  return {s: "select_single", table: tb.name, cols, assign, target, sql: lowered.sql, ...loweredArgs(lowered, acc)};
}

/**
 * ASSIGN into a generic field symbol: a component of a structure by name
 * (sy-subrc 4 when there is none), what a data reference points to
 * (sy-subrc 4 when it is initial; not measured), or a value, bound.
 */
function assignStatement(node, ctx, text) {
  const fsName = upper(node.findDirectExpression(Expressions.FSTarget)?.concatTokens() ?? "");
  const fsType = ctx.fieldSymbols?.get(fsName);
  if (!fsType) throw new Unsupported(`ASSIGN to ${fsName || "?"}`);
  if (fsType.k === "struct" && !/\b(CASTING|INCREMENT|RANGE|COMPONENT)\b/i.test(text)) {
    // ASSIGN ref->* TO <typed>: the reference must point at a value of that
    // structure; one of another Go type (an ABAP-compatible structure of
    // another name included) is refused at run time, not moved by layout
    const inner = node.findDirectExpression(Expressions.AssignSource)?.getChildren().filter((c) => !isTok(c));
    const kids = inner?.length === 1 && isExpr(inner[0], Expressions.Source) && inner[0].findDirectExpression(Expressions.Dereference) ? inner[0].getChildren() : null;
    if (kids?.length === 2) {
      const ref = sourceOperand(kids[0], ctx);
      if (ref.type.k !== "dref") throw new Unsupported(`->* of a ${ref.type.k}`);
      return {s: "assign_deref_typed", fs: {e: "fs", name: fsName, type: fsType}, ref, text};
    }
  }
  if (fsType.k !== "data") throw new Unsupported(`ASSIGN to a typed field symbol: ${text}`);
  if (/\b(CASTING|INCREMENT|RANGE)\b/i.test(text)) throw new Unsupported(`ASSIGN form: ${text}`);
  const fs = {e: "fs", name: fsName, type: fsType};
  const src = node.findDirectExpression(Expressions.AssignSource);
  const parts = src.getChildren().filter((c) => !isTok(c));
  if (/^ASSIGN\s+COMPONENT\b/i.test(text)) {
    if (parts.length !== 2) throw new Unsupported(`ASSIGN COMPONENT form: ${text}`);
    const name = sourceOperand(parts[0].getFirstChild(), ctx);
    if (!["string", "c"].includes(name.type.k)) throw new Unsupported(`ASSIGN COMPONENT by a ${name.type.k}`);
    return {s: "assign_comp", fs, name: convert(name, S), from: convert(source(parts[1], ctx), {k: "data"})};
  }
  if (parts.length !== 1 || !isExpr(parts[0], Expressions.Source)) throw new Unsupported(`ASSIGN form: ${text}`);
  const inner = parts[0];
  if (inner.findDirectExpression(Expressions.Dereference)) {
    const kids = inner.getChildren();
    if (kids.length !== 2) throw new Unsupported(`ASSIGN form: ${text}`);
    const ref = sourceOperand(kids[0], ctx);
    if (ref.type.k !== "dref") throw new Unsupported(`->* of a ${ref.type.k}`);
    return {s: "assign_deref", fs, ref};
  }
  return {s: "assign_data", fs, value: convert(source(inner, ctx), fsType)};
}

/**
 * CREATE DATA dref TYPE t | TYPE STANDARD TABLE OF t [WITH DEFAULT KEY], with
 * t a type known at build time (ultra/sadl: the generated CDS and table
 * sources of OSG's SADL runtime). The reference points at a new initial
 * value of that type. A type given by name at run time ((name)), LIKE, REF
 * TO, LENGTH / DECIMALS and HANDLE are other forms, not taken here.
 */
function createDataStatic(node, ctx, text) {
  // CREATE DATA r TYPE (name) / TYPE STANDARD TABLE OF (name): a table or
  // view of the dictionary, looked up at run time in the table registry
  // (A4H ZCL_GOGEN_T_CRDYN: the name in any case, an unknown one
  // CX_SY_CREATE_DATA_ERROR with the reference untouched)
  const dyn = /^CREATE\s+DATA\s+\S+\s+TYPE\s+(STANDARD\s+TABLE\s+OF\s+)?\(\s*([^()\s]+)\s*\)(\s+WITH\s+(NON-UNIQUE\s+)?DEFAULT\s+KEY)?\s*\.?$/i.exec(text);
  if (dyn) {
    const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (target.type.k !== "dref") throw new Unsupported(`CREATE DATA into a ${target.type.k}`);
    const src = node.findDirectExpression(Expressions.Dynamic)?.findFirstExpression(Expressions.FieldChain)
      ?? node.findFirstExpression(Expressions.Dynamic)?.findFirstExpression(Expressions.FieldChain);
    let name;
    if (src) name = convert(fieldChain(src, ctx), S);
    else if (/^'.*'$/.test(dyn[2])) name = {e: "str", value: dyn[2].slice(1, -1), type: S};
    else throw new Unsupported(`CREATE DATA TYPE (${dyn[2]}): the name`);
    return {s: "create_data_dyn", target, name, table: !!dyn[1]};
  }
  const m = /^CREATE\s+DATA\s+\S+\s+TYPE\s+(STANDARD\s+TABLE\s+OF\s+)?([\w\/=>~-]+)(\s+WITH\s+(NON-UNIQUE\s+)?DEFAULT\s+KEY)?\s*\.?$/i.exec(text);
  if (!m || /^(REF|LINE|RANGE|SORTED|HASHED|TABLE)$/i.test(m[2])) throw new Unsupported(`statement CreateData: ${text}`);
  const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
  if (target.type.k !== "dref") throw new Unsupported(`CREATE DATA into a ${target.type.k}`);
  const name = upper(m[2]);
  let t;
  const ddic = ctx.reg.getObject("TABL", name) ?? ctx.reg.getObject("VIEW", name) ?? ctx.reg.getObject("TTYP", name) ?? ctx.reg.getObject("DTEL", name);
  if (!/=>/.test(name) && !(ctx.scope.findType?.(name)) && ddic) {
    let at;
    try { at = ddic.parseType(ctx.reg); } catch { throw new Unsupported(`CREATE DATA TYPE ${name}: its type does not resolve`); }
    t = typeOf(at, name, ctx.program);
  } else t = namedType(node.findDirectExpression(Expressions.TypeName) ?? {concatTokens: () => m[2]}, ctx);
  if (["ref", "exc", "data", "dref"].includes(t.k)) throw new Unsupported(`CREATE DATA TYPE ${name}: a ${t.k}`);
  return {s: "create_data", target, type: m[1] ? {k: "table", row: t} : t};
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
  const written = clsNode ? upper(clsNode.concatTokens()) : target.type.name;
  // a local class of this class's owner (LOCAL_CLASSES), by its compiled name
  const cls = ctx.program.locals?.get(`${ctx.owner ?? ctx.className}|${written}`) ?? written;
  if (!ctx.program.wanted.has(cls)) throw new Unsupported(`CREATE OBJECT ${cls}: the class is not compiled in this program`);
  const sig = constructorSignature(ctx, cls);
  const given = new Map();
  for (const p of params?.findAllExpressions(Expressions.ParameterS) ?? []) {
    given.set(upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()), p.findDirectExpression(Expressions.Source));
  }
  const args = sig.map((p) => {
    if (p.suppliedOf) return {dir: "importing", byValue: true, type: p.type, value: {e: "chars", value: given.has(p.suppliedOf) ? "X" : "", type: p.type}};
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

/*
 * RAISE EXCEPTION of a class-based exception: the object is made as CREATE
 * OBJECT makes it (TYPE cls EXPORTING ...) or is one that exists (RAISE
 * EXCEPTION obj, the same object arrives in the CATCH: A4H 2026-09-23).
 * The class must be compiled in the program; RESUMABLE, SHORTDUMP and the
 * MESSAGE forms are refused.
 */
function raiseException(node, ctx, text) {
  if (/^RAISE\s+(RESUMABLE|SHORTDUMP)\b/i.test(text)) throw new Unsupported(`RAISE ${text.split(/\s+/)[1].toUpperCase()}: ${text.slice(0, 80)}`);
  if (/^RAISE\s+EXCEPTION\s+TYPE\s+\S+\s+(MESSAGE|USING\s+MESSAGE)\b/i.test(text)) throw new Unsupported(`RAISE EXCEPTION with MESSAGE: ${text.slice(0, 80)}`);
  const clsNode = node.findDirectExpression(Expressions.ClassName);
  if (clsNode) {
    const cls = upper(clsNode.concatTokens());
    if (!ctx.program.wanted.has(cls)) throw new Unsupported(`RAISE EXCEPTION TYPE ${cls}: the class is not compiled in this program`);
    const params = node.findDirectExpression(Expressions.ParameterListS);
    const given = new Map();
    for (const p of params?.findAllExpressions(Expressions.ParameterS) ?? []) {
      given.set(upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()), p.findDirectExpression(Expressions.Source));
    }
    const sig = constructorSignature(ctx, cls);
    for (const n of given.keys()) if (!sig.some((p) => p.name === n)) throw new Unsupported(`RAISE EXCEPTION TYPE ${cls}: no constructor parameter ${n}`);
    const args = sig.map((p) => {
      if (p.suppliedOf) return {dir: "importing", byValue: true, type: p.type, value: {e: "chars", value: given.has(p.suppliedOf) ? "X" : "", type: p.type}};
      const src = given.get(p.name);
      if (src === undefined) {
        if (p.default !== undefined) return {dir: "importing", byValue: p.byValue, type: p.type, value: defaultValue(p, ctx)};
        if (p.optional) return {dir: "importing", byValue: p.byValue, type: p.type, value: {e: "zero", type: p.type}};
        throw new Unsupported(`RAISE EXCEPTION TYPE ${cls}: ${p.name} not supplied`);
      }
      return {dir: "importing", byValue: p.byValue, type: p.type, value: convert(source(src, ctx, p.type), p.type)};
    });
    return {s: "raise", value: {e: "new", cls, args, type: {k: "ref", name: cls}}, cls};
  }
  const src = node.findDirectExpression(Expressions.Source) ?? node.findDirectExpression(Expressions.SimpleSource2);
  if (!src) throw new Unsupported(`RAISE EXCEPTION form: ${text.slice(0, 80)}`);
  const value = source(src, ctx);
  if (value.type.k !== "ref" || value.type.name === "OBJECT") throw new Unsupported(`RAISE EXCEPTION of a ${value.type.k === "ref" ? "REF TO object" : value.type.k}`);
  return {s: "raise", value, cls: null};
}

/**
 * The superclass of every compiled exception class (and of its ancestors,
 * compiled or not), for a CATCH to walk at run time: the object raised is
 * told by its class, which a RAISE EXCEPTION obj only knows then.
 */
function exceptionSupers(reg, program) {
  const out = {};
  for (const c of program.classes) {
    const chain = [c.name, ...ancestors(reg, c.name)];
    if (!chain.includes("CX_ROOT")) continue;
    for (let i = 0; i + 1 < chain.length; i += 1) out[chain[i]] = chain[i + 1];
  }
  return out;
}

/**
 * The classes a CATCH takes that are raised as objects: every compiled class
 * that is one of the named classes or inherits from one (by the hierarchy
 * abaplint knows, so an ancestor outside the program still counts).
 */
function caughtClasses(ctx, names) {
  const own = [];
  for (const w of ctx.program.wanted) if (names.some((n) => isSubclass(ctx.reg, w, n))) own.push(w);
  return own.sort();
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
  const own = p.getImporting().map((x) => ({name: upper(x.getName()), dir: "importing", byValue: x.getMeta().includes("pass_by_value"),
    type: typeOf(x.getType(), `${clsName}=>CONSTRUCTOR`, ctx.program), default: defaultOf(p, x), optional: optional.has(upper(x.getName()))}));
  return withSupplied(ctx.program, `${declaringClass(ctx.reg, clsName, "CONSTRUCTOR", "method") ?? clsName}=>CONSTRUCTOR`, own);
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

/** the decimals a system prints for a p expression in a template, or null */
function templateDecimals(v) {
  if (v.type.k === "p" && !v.type.calc) return v.type.dec ?? 0;
  if (v.fromP) return v.fromP.dec ?? 0;
  if (v.type.k === "i" || v.type.k === "int8") return 0;
  if (v.e === "conv" && ["i2pc"].includes(v.kind)) return 0;
  if (v.e === "neg") return templateDecimals(v.x);
  if (v.e === "bin" && (v.op === "+" || v.op === "-")) {
    const l = templateDecimals(v.l);
    const r = templateDecimals(v.r);
    return l === null || r === null ? null : Math.max(l, r);
  }
  if (v.e === "str" && /^-?\d+$/.test(v.value)) return 0;
  return null;
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
        // KEY = value pairs; a quoted value may itself be '=' (PAD = '=',
        // ultra/itab: zcl_stg_segw_gen's include name), which a split on
        // "=" cut in two
        const src = fmt.concatTokens();
        const pairs = [...src.matchAll(/(\w+)\s*=\s*('(?:[^']|'')*'|[^\s']+)/g)];
        if (pairs.map((m) => m[0]).join(" ").replace(/\s+/g, "") !== src.replace(/\s+/g, "")) throw new Unsupported(`template formatting ${src}`);
        const words = pairs.flatMap((m) => [m[1], m[2]]);
        for (let i = 0; i < words.length; i += 2) {
          const k = upper(words[i]);
          const val = words[i + 1];
          if (k === "DECIMALS" && /^\d+$/.test(val) && (v.type.k === "f" || v.type.k === "p")) opts.decimals = Number(val);
          // NUMBER = RAW of a p is its plain form (A4H PDFMT n:)
          else if (k === "NUMBER" && upper(val) === "RAW" && v.type.k === "p") opts.raw = true;
          else if (k === "WIDTH" && /^\d+$/.test(val)) opts.width = Number(val);
          else if (k === "ALIGN" && /^(LEFT|RIGHT|CENTER)$/i.test(val)) opts.align = upper(val);
          else if (k === "PAD" && /^'.'$/.test(val)) opts.pad = val.slice(1, 2);
          else throw new Unsupported(`template formatting ${k} = ${val} for a ${v.type.k}`);
        }
      }
      // f: seventeen significant digits, positional, measured on A4H (abap.FmtF)
      // n: its digits as they are (A4H PDCONV pn:0013)
      if (!["i", "int8", "f", "string", "c", "x", "xstring", "data", "d", "t", "p", "n"].includes(v.type.k)) throw new Unsupported(`${v.type.k} in a string template`);
      // a p field prints its own decimals; an arithmetic expression of
      // calculation type p prints decimals a system decides by rules not
      // fully measured (A4H: 1.25 + 1 is 2.25, but 1.25 * 2 is 2.500 and
      // 1.25 * 1.25 is 1.56250), so only + and - are taken, with the most
      // decimals of their operands
      if (v.type.k === "p") {
        opts.pdec = v.type.calc ? templateDecimals(v) : v.type.dec;
        if (opts.pdec === null && opts.decimals === undefined) throw new Unsupported(`an arithmetic expression of type p with * or / in a string template: its decimals are not measured`);
      }
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
  } else if (kids.length === 3 && isTok(kids[1], "->") && isExpr(kids[2], Expressions.MethodCall) && !isExpr(kids[0], Expressions.MethodCall)) {
    receiver = isExpr(kids[0], Expressions.FieldChain) || isExpr(kids[0], Expressions.SourceField) ? fieldChain(kids[0], ctx) : null;
    if (receiver === null || receiver.type.k !== "ref") throw new Unsupported(`call through ${kids[0].concatTokens()}`);
    if (!receiver.type.intf && !ctx.program.wanted.has(receiver.type.name)) throw new Unsupported(`call on a ${receiver.type.name}, which is not compiled in this program`);
    owner = receiver.type.name;
    mc = kids[2];
  } else if ((kids.length > 3 || isExpr(kids[0], Expressions.MethodCall)) && isTok(kids[kids.length - 2], "->") && isExpr(kids[kids.length - 1], Expressions.MethodCall)) {
    // a->b( )->c( ): the receiver is what the chain before the last -> returns;
    // so is m( )->n( ) and zif_x~m( )->n( ), whose head is a call on me
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
    if (t.type.k === "data") return {e: "lines_data", x: t, type: I};
    if (t.type.k !== "table") throw new Unsupported("lines( ) of a non-table");
    return {e: "lines", table: t, type: I};
  }
  if (receiver === null && owner === null && STRING_FNS[name] && !ctx.signatures.has(name)) return stringFn(name, direct, named, ctx, chain.concatTokens());
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
  // ultra/itab: uccp( 'FEFF' ), the character of a code point given as four
  // hex digits (open-abap-core: the text into x(2), that into i, uccpi( )).
  // Its parameter is TYPE simple, outside the subset, so only a literal of
  // four hex digits is taken (zcl_stg_segw_gen's BOM)
  if (owner === "CL_ABAP_CONV_IN_CE" && name === "UCCP") {
    // (lower case is no hex digit there: A4H gives U+0000 for '00e4')
    const lit = /^'([0-9A-F]{4})'$/.exec(direct?.concatTokens() ?? "");
    if (!lit) throw new Unsupported(`cl_abap_conv_in_ce=>uccp( ) of other than a literal of four hex digits: ${chain.concatTokens()}`);
    return {e: "uccpi", x: {e: "int", value: parseInt(lit[1], 16), type: I}, type: C(1)};
  }
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
    // me->intf~m( ) of an interface a superclass implements: that class's
    const at = name.includes("~") ? implementingClass(ctx.reg, ctx.className, name.split("~")[0]) : declaringClass(ctx.reg, ctx.className, name, "method");
    if (at === undefined || at === ctx.className) throw new Unsupported(`unknown method ${name}`);
    if (declaredMethod(ctx.reg, at, name)?.getVisibility?.() === 1) throw new Unsupported(`${name} is private in ${at}`);
    sig = methodSignature(ctx, at, name);
    if (sig.static) owner = at;
  } else {
    // an alias the class inherits names an interface method its superclass
    // implements: the signature is the interface's
    sig = owner === null ? (ctx.signatures.get(qualified) ?? (alias ? methodSignature(ctx, ctx.className, qualified) : undefined))
      : methodSignature(ctx, owner, qualified);
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
    if (p.suppliedOf) {
      const yes = given.has(p.suppliedOf) || targets.has(p.suppliedOf);
      return {dir: "importing", byValue: true, type: p.type, value: {e: "chars", value: yes ? "X" : "", type: p.type}};
    }
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
    // a generic EXPORTING / CHANGING (TYPE any, data): the callee writes
    // through a binding to the caller's typed variable, as ABAP passes it by
    // reference; an ANY TABLE takes only a table
    if (p.type.k === "data" && !p.byValue && t.type.k !== "data" && t.type.k !== "dref" && (!p.type.table || t.type.k === "table")) {
      return {dir: p.dir, place: null, wrap: {e: "wrap", x: t, type: p.type}, type: p.type};
    }
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
  let t = p.default;
  // a constant of the class or interface that declares the method, by its
  // plain name: its VALUE, a literal
  if (/^[a-z_][\w]*$/i.test(t) && !/^abap_(true|false)$/i.test(t) && p.defaultOwner !== undefined) {
    const def = ctx.reg.getObject("INTF", p.defaultOwner)?.getDefinition() ?? ctx.reg.getObject("CLAS", p.defaultOwner)?.getDefinition();
    const c = def?.getAttributes().getConstants().find((x) => upper(x.getName()) === upper(t));
    if (c !== undefined && typeof c.getValue() === "string") t = c.getValue();
  }
  if (/^-?\d+$/.test(t)) return convert({e: "int", value: Number(t), type: I}, p.type);
  if (/^'.*'$/s.test(t)) return convert({e: "chars", value: t.slice(1, -1), type: C(Math.max(1, t.length - 2))}, p.type);
  if (/^`.*`$/s.test(t)) return convert({e: "str", value: t.slice(1, -1).replace(/``/g, "`"), type: S}, p.type);
  if (/^abap_true$/i.test(t)) return convert({e: "chars", value: "X", type: C(1)}, p.type);
  if (/^abap_false$/i.test(t)) return convert({e: "chars", value: "", type: C(1)}, p.type);
  // a constant: CLS=>C, or C of the class or interface the method is declared in
  const named = /^([\w\/]+)=>(\w+)$/.exec(t) ?? (/^\w+$/.test(t) && p.defOwner ? [t, p.defOwner, t] : null);
  if (named) return convert(resolveStatic(upper(named[1]), upper(named[2]), ctx), p.type);
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
  // of a p (A4H PDFMT fn:, PDCMP f:): abs( ) and frac( ) keep its type,
  // sign( ) is an i, ceil( ) floor( ) trunc( ) have no decimals (-1.5 gives
  // -1, -2, -1 in a template, -1.0 and -2.0 in a p(8,1))
  if (arg.type.k === "p") {
    if (name === "SIGN") return {e: "fn", name, args: [arg], type: I};
    if (["CEIL", "FLOOR", "TRUNC"].includes(name)) return {e: "fn", name, args: [arg], type: arg.type.calc ? P31 : {k: "p", len: arg.type.len, dec: 0}};
    return {e: "fn", name, args: [arg], type: arg.type};
  }
  if (!numeric(arg.type)) throw new Unsupported(`${name}( ) of a ${arg.type.k}`);
  return {e: "fn", name, args: [arg], type: arg.type};
}

/* ------------------------------------------------------------------- conversion */

/**
 * An explicit conversion node where the types differ, nothing where they
 * agree. The kinds are the ones ABAP's conversion rules separate; a pair
 * that is not listed is refused, not approximated.
 */
/** CToP and PFit of go/abap packed.go at build time, for a literal: the
 * value as the field holds it, or null for no number or an overflow */
export function packedLiteral(text, to) {
  let t = String(text).replace(/^ +| +$/g, "");
  let neg = false;
  if (t.endsWith("-")) { neg = true; t = t.slice(0, -1).replace(/ +$/, ""); } else if (t.startsWith("-")) { neg = true; t = t.slice(1).replace(/^ +/, ""); } else if (t.startsWith("+")) t = t.slice(1).replace(/^ +/, "");
  if (t === "") t = "0";
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[1] + (m[2] ?? "")) === "") return null;
  const frac = m[2] ?? "";
  let v = BigInt((m[1] || "0") + frac);
  const dec = to.dec ?? 0;
  if (frac.length > dec) {
    const div = 10n ** BigInt(frac.length - dec);
    const q = v / div;
    v = (v % div) * 2n >= div ? q + 1n : q;
  } else {
    v *= 10n ** BigInt(dec - frac.length);
  }
  const digits = v.toString();
  if (v !== 0n && digits.length > 2 * to.len - 1) return null;
  const padded = digits.padStart(dec + 1, "0");
  const out = dec > 0 ? `${padded.slice(0, -dec)}.${padded.slice(-dec)}` : padded;
  return neg && v !== 0n ? `-${out}` : out;
}

export function convert(expr, to) {
  // a typed value where a generic one is expected is bound, not copied; a
  // generic one where a type is expected is read through its descriptor
  if (to.k === "data" && expr.type.k === "data") return expr;
  if (to.k === "dref" && expr.type.k === "dref") return expr;
  if (to.k === "data") {
    if (to.table && expr.type.k !== "table") throw new Unsupported(`a ${expr.type.k} where ANY TABLE is expected`);
    return {e: "wrap", x: expr, type: to};
  }
  if (expr.type.k === "data") {
    // ultra/itab: an operand of generic arithmetic, read into one calculation type
    if (GEN_CALC && (["i", "int8", "f"].includes(to.k) || (to.k === "p" && to.calc))) return {e: "unwrap_calc", x: expr, type: to};
    if (!["string", "c", "i", "d", "t", "p"].includes(to.k) || to.calc) throw new Unsupported(`a generic value moved into a ${to.k}`);
    return {e: "unwrap", x: expr, type: to};
  }
  const from = expr.type;
  if (sameType(from, to)) return expr;
  const ok = (kind) => ({e: "conv", kind, from, to, x: expr, type: to});
  if (numeric(from) && numeric(to)) return ok("num");
  if (to.k === "string" && from.k === "c") return ok("c2s");
  if (to.k === "c" && charlike(from)) return ok("s2c");
  // c -> d, measured on A4H: the first eight characters, no check ('ABC' is
  // kept, reads back as ABC and counts as 0 days); '' is not initial
  if (to.k === "d" && charlike(from)) return ok("s2c");
  // c -> t: the first six characters, the same rule (measured on A4H for
  // '123456' only, which then reads back 12 and 34 by offset)
  if (to.k === "t" && charlike(from)) return ok("s2c");
  // d -> i, measured on A4H: days since 00010101 (which is 0), Julian
  // before 15821015 (15821004 is 577736, 15821015 is 577737), an invalid
  // date is 0 (abap.DToI)
  if (to.k === "i" && from.k === "d") return ok("d2i");
  // d / t into characters: the eight / six digits as they are (both are
  // held as their digits already); into a c they are cut or padded as any
  // characters are
  if (to.k === "string" && (from.k === "d" || from.k === "t")) return {...expr, type: to};
  if (to.k === "c" && (from.k === "d" || from.k === "t")) return ok("s2c");
  // c -> n for a literal of exactly the field's digits only: the characters
  // are the value (anything else, blanks, signs, other lengths, is a
  // conversion rule not measured here)
  if (to.k === "n" && expr.e === "chars" && to.len && new RegExp(`^[0-9]{${to.len}}$`).test(expr.value)) return {...expr, type: to};
  // i -> string and x -> string are conversion rules not measured yet (the
  // sign of an i goes to the END there, unlike in a template): refused
  // until an A4H probe says what they give
  // i -> string, measured on A4H: the digits and then a place for the sign,
  // 42 is "42 ", -5 is "5-" (a template writes -5; a move does not)
  if (to.k === "string" && from.k === "i") return ok("i2s");
  if (to.k === "x" && from.k === "i") return ok("i2x");
  // packed numbers (go/abap packed.go, A4H 2026-09-24, ZCL_GOGEN_T_PD*).
  // Into calculation type p: exact, nothing rounded yet
  if (to.k === "p" && to.calc) {
    if (from.k === "p") return {...expr, type: to, fromP: from.calc ? expr.fromP : from};
    if (from.k === "i" || from.k === "int8") return ok("i2pc");
    if (charlike(from)) return ok("c2pc");
    throw new Unsupported(`conversion ${from.k} -> calculation type p`);
  }
  // into a p field: rounded half away from zero to its decimals; a value
  // that does not fit raises CX_SY_ARITHMETIC_OVERFLOW after arithmetic and
  // CX_SY_CONVERSION_OVERFLOW after a move
  if (to.k === "p") {
    const arith = expr.e === "bin" || expr.e === "neg";
    if (from.k === "p") return {...ok("p2p"), arith};
    if (from.k === "i" || from.k === "int8") return ok("i2p");
    if (from.k === "f") return ok("f2p");
    // a character literal is converted at build time (CONSTANTS ... TYPE
    // timestamp VALUE '20260912010000'); one that is no number or does not
    // fit is refused here rather than raised at run time
    if ((expr.e === "chars" || expr.e === "str") && charlike(from)) {
      const v = packedLiteral(expr.value, to);
      if (v === null) throw new Unsupported(`the literal '${expr.value}' is no number or does not fit p LENGTH ${to.len} DECIMALS ${to.dec}`);
      return {e: "str", value: v, type: to};
    }
    if (charlike(from)) return ok("c2p");
    if (from.k === "n") return ok("c2p");
    throw new Unsupported(`conversion ${from.k} -> p`);
  }
  if (from.k === "p") {
    const arith = expr.e === "bin" || expr.e === "neg";
    if (to.k === "i" || to.k === "int8") return {...ok(to.k === "i" ? "p2i" : "p2i8"), arith};
    if (to.k === "f") return ok("p2f");
    // into characters and n: the field's own decimals (a calculation type
    // p value has none fixed, and what a system prints for it is not
    // measured beyond + and -)
    if (from.calc && ["string", "c", "n"].includes(to.k)) throw new Unsupported(`an arithmetic expression of type p moved into a ${to.k}: not measured`);
    if (to.k === "string") return ok("p2s");
    if (to.k === "c") return ok("p2c");
    if (to.k === "n") return ok("p2n");
    throw new Unsupported(`conversion p -> ${to.k}`);
  }
  // x / xstring into characters: the hex digits, upper case, zeros kept; a c
  // target cuts them to its length (A4H 2026-09-23: x'0A0B' into c(3) is 0A0)
  if ((to.k === "string" || to.k === "c") && (from.k === "x" || from.k === "xstring")) return ok("x2s");
  // x <-> xstring: the bytes; into x LENGTH n cut or padded right with 00
  if (to.k === "x" && (from.k === "xstring" || from.k === "x")) return ok("xs2x");
  if (to.k === "xstring" && from.k === "x") return {...expr, type: to};
  // x -> i: an x shorter than four bytes is filled with 00 on the left, so
  // it reads unsigned (measured on A4H: FF gives 255); four and more bytes
  // are not measured
  if (to.k === "i" && from.k === "x" && from.len < 4) return ok("x2i");
  if (numeric(to) && charlike(from)) return ok("c2n");
  if (to.k === "table" && from.k === "table" && sameType(from.row, to.row)) return expr;
  // two structures of one technical type (the same components in the same
  // order, each of the same type and length; names may differ): a move is
  // component by component in order, as ABAP moves compatible structures.
  // Anything else between structures (a layout move of another shape) is
  // refused. A T100 key constant into TEXTID is the case that needs it.
  if (from.k === "struct" && to.k === "struct" && PROGRAM) {
    const ff = PROGRAM.structs.get(from.go)?.fields;
    const tf = PROGRAM.structs.get(to.go)?.fields;
    const flat = (t) => !["struct", "table", "ref", "data", "dref", "exc"].includes(t.k);
    if (ff && tf && ff.length === tf.length && ff.every((f, i) => flat(f.type) && sameType(f.type, tf[i].type) && (f.type.len ?? null) === (tf[i].type.len ?? null))) {
      return {e: "conv", kind: "struct_layout", from, to, x: expr, type: to, pairs: tf.map((f, i) => [f.name, ff[i].name])};
    }
  }
  if (from.k === "ref" && to.k === "ref") {
    // up-cast: a class into an interface it implements, or any reference into
    // the same interface; a down-cast needs CAST and is refused
    if (to.intf && (to.name === "OBJECT" || implementsIntf(expr, from.name, to.name))) return {e: "upcast", x: expr, type: to};
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
let PROGRAM = null;
function implementsIntf(expr, cls, intf) {
  if (cls === intf) return true;
  for (const c of [cls, ...(REG ? ancestors(REG, cls) : [])]) {
    const def = REG?.getObject("CLAS", c)?.getDefinition() ?? REG?.getObject("INTF", c)?.getDefinition() ?? LOCAL_DEFS.get(c);
    if ((def?.getImplementing?.() ?? []).some((i) => upper(i.name) === intf || (REG && componentInterfaces(REG, upper(i.name)).includes(intf)))) return true;
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
  if (/\bIS\s+(NOT\s+)?SUPPLIED\b/.test(text)) {
    const nm = upper(/^(?:NOT\s+)?(\S+)\s+IS\b/.exec(text)?.[1] ?? "");
    if (!ctx.sig.params.some((p) => p.suppliedOf === nm)) throw new Unsupported(`${nm} IS SUPPLIED: not a parameter this method's declaration tracks`);
    const r = {c: "not", x: {c: "initial", x: {e: "var", name: `SUP_${nm}`, type: C(1)}}};
    return /\bIS\s+NOT\s+SUPPLIED\b/.test(text) !== not ? {c: "not", x: r} : r;
  }
  if (/\bIS\s+(NOT\s+)?ASSIGNED\b/.test(text)) {
    const nm = /<[\w]+>/.exec(text)?.[0];
    if (!nm || !ctx.fieldSymbols.has(nm)) throw new Unsupported(`IS ASSIGNED: ${text}`);
    fsCheck(nm, ctx);
    const r = {c: "assigned", fs: {e: "fs", name: nm, type: ctx.fieldSymbols.get(nm)}};
    return /\bIS\s+NOT\s+ASSIGNED\b/.test(text) !== not ? {c: "not", x: r} : r;
  }
  if (/\bIS\s+(NOT\s+)?BOUND\b/.test(text) && sources.length === 1) {
    const v = source(sources[0], ctx);
    if (v.type.k === "dref") {
      const r = {c: "initial", x: v};
      return /\bIS\s+NOT\s+BOUND\b/.test(text) !== not ? r : {c: "not", x: r};
    }
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
  if (op === "CO" || op === "CS" || op === "CN" || op === "NS") {
    // measured on A4H: CO is true for an empty operand; CS ignores case and
    // an empty pattern is always found; trailing blanks count in a string,
    // a c operand has none stored. CN and NS are the negations of CO and CS
    // (ultra/itab: NS in the demo DPC's search; A4H ZCL_GOGEN_T_NSCN)
    const neg = op === "CN" || op === "NS";
    const r = {c: op === "CO" || op === "CN" ? "co" : "cs", l: convert(source(sources[0], ctx), S), r: convert(source(sources[1], ctx), S)};
    return neg !== not ? {c: "not", x: r} : r;
  }
  if (["CP", "NP", "CA", "NA"].includes(op)) {
    // measured on A4H (2026-09-23): CP ignores case except after #, + is one
    // character, #* #+ ## are literal; trailing blanks count in a string and
    // not in a c, and a c pattern that is all blanks is one blank ('' CP ''
    // is false). CA is case-sensitive. sy-fdpos is not set (not read on
    // any path compiled so far; reading it is refused)
    const rs = source(sources[1], ctx);
    const r = {c: op === "CP" || op === "NP" ? "cp" : "ca", l: convert(source(sources[0], ctx), S), r: convert(rs, S), cpat: rs.type.k === "c"};
    const neg = (op === "NP" || op === "NA") !== not;
    return neg ? {c: "not", x: r} : r;
  }
  if (!["=", "<>", "<", "<=", ">", ">="].includes(op)) throw new Unsupported(`comparison operator ${op}`);
  const types = [...leafTypes(sources[0], ctx), ...leafTypes(sources[1], ctx)];
  let r;
  const arithL = hasArith(sources[0]);
  const arithR = hasArith(sources[1]);
  // an arithmetic expression compared with a character operand does not
  // activate on A4H ("An arithmetic expression cannot be compared with the
  // non-numeric operand"; `lv_s + 0` can be)
  for (const [a, other] of [[arithL, sources[1]], [arithR, sources[0]]]) {
    if (a && !hasArith(other) && leafTypes(other, ctx).some(charlike)) {
      throw new Unsupported(`an arithmetic expression compared with the character operand ${other.concatTokens()} (does not activate on A4H)`);
    }
  }
  // calculation type p for the comparison (A4H 2026-09-24, PDFMT c: and
  // PDCMP): a p on either side, or a character operand inside arithmetic
  // (`lv_i * 86400 * 1000 > lv_s + 0` does not overflow i); a p against a
  // character operand compares numbers ('1.50' = 1.5)
  if (!types.some((t) => t.k === "f") && (types.some((t) => t.k === "p") || ((arithL || arithR) && types.some(charlike)))) {
    const odd = types.find((t) => !["p", "i", "int8", "c", "string"].includes(t.k));
    if (odd) throw new Unsupported(`comparison of p with a ${odd.k}: ${node.concatTokens()}`);
    r = {c: "cmp", op, l: convert(arith(sources[0], ctx, arithL ? P31 : undefined), P31), r: convert(arith(sources[1], ctx, arithR ? P31 : undefined), P31), type: P31};
    return not ? {c: "not", x: r} : r;
  }
  if (types.some(numeric) || (types.some((t) => t.k === "p") && types.some((t) => t.k === "f"))) {
    // numbers compare numerically; a character operand is converted to the
    // numeric type (f when any operand is f). Against i it is converted to
    // i, rounded (A4H PDCALC: '-0.4' < 0 is false, '1.4' = 1 is true)
    const calc = types.some((t) => t.k === "f") ? F : types.some((t) => t.k === "int8") ? INT8 : I;
    if (types.some(charlike) && calc.k === "int8") throw new Unsupported(`comparison of int8 with characters: ${node.concatTokens()}`);
    r = {c: "cmp", op, l: convert(arith(sources[0], ctx, arithL ? calc : undefined), calc), r: convert(arith(sources[1], ctx, arithR ? calc : undefined), calc), type: calc};
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
