// IR -> Go source, for the Go backend spike.
//
// Nothing here decides semantics: the IR already says which calculation type
// every operator runs in and where a conversion happens. This file only
// spells it. A method takes the Session first -- the roll area -- so the
// same generated code runs on any goroutine. An instance method has the
// object as its receiver; a static one is a plain function.

const GO_RESERVED = new Set(("break default func interface select case defer go map struct chan else goto package switch const "
  + "fallthrough if range type continue for import return var append cap clear close complex copy delete imag len make max min new "
  + "panic print println real recover bool byte error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 "
  + "uint32 uint64 uintptr true false nil iota me s math abap").split(" "));

export const ident = (name) => {
  // INTF~ATTR, an interface's attribute in the object, keeps the ~ apart
  // from the _ of an attribute of the class's own
  const id = String(name).toLowerCase().replace(/~/g, "__").replace(/[^a-z0-9_]/g, "_");
  return GO_RESERVED.has(id) || /^\d/.test(id) ? `${id}_` : id;
};
const typeName = (s) => String(s).toUpperCase().replace(/=>|~|-/g, "__").replace(/[^A-Z0-9_]/g, "_");
export const funcName = (cls, method) => `${typeName(cls)}_${typeName(method)}`;
const evType = (key) => `EV_${typeName(key)}`;
/*
 * ultra/events: CLASS_CONSTRUCTOR runs once, at the first use of the class:
 * the first NEW of it or of a subclass, or the first call of one of its
 * static methods (ABAP also counts a read of a static attribute from
 * outside; the front end compiles no such read). The superclass's runs
 * first. The flag is process-wide, as the class data is. CL_ABAP_CHAR_
 * UTILITIES is left out: its class constructor is two kernel lines setting
 * constants the front end already knows (CHAR_UTILITIES).
 */
const ownCctor = (cls) => cls.name !== "CL_ABAP_CHAR_UTILITIES"
  && (cls.methods.some((m) => m.name === "CLASS_CONSTRUCTOR") || (cls.stubs ?? []).some((m) => m.name === "CLASS_CONSTRUCTOR"));
function chainCctor(cls) {
  for (let c = cls; c; c = c.super ? CLASSES.get(c.super) : null) if (ownCctor(c)) return true;
  return false;
}

export function goType(t) {
  switch (t.k) {
    case "i": return "int32";
    case "int8": return "int64";
    case "f": return "float64";
    case "string": case "c": case "x": case "xstring": return "string";
    case "table": return `[]${goType(t.row)}`;
    case "struct": return t.go;
    case "ref": return t.name === "OBJECT" ? "any" : t.intf ? typeName(t.name) : POLY.has(t.name) ? `I_${typeName(t.name)}` : `*${typeName(t.name)}`;
    case "exc": return "*abap.Exception";
    case "data": case "dref": return "abap.Data";
    case "d": case "t": case "p": case "n": return "string";
    default: throw new Error(`no Go type for ${t.k}`);
  }
}

// a p field holds its decimals: initial is 0, 0.0, 0.00 ... (go/abap packed.go)
const pZero = (t) => (t.calc || !t.dec ? "0" : `0.${"0".repeat(t.dec)}`);

// an x field is always its full length: initial is that many 00 bytes
const zero = (t) => (t.k === "i" || t.k === "int8" || t.k === "f" ? "0" : t.k === "x" ? JSON.stringify("\u0000".repeat(t.len)).replaceAll("\\u0000", "\\x00")
  : t.k === "string" || t.k === "c" || t.k === "xstring" ? `""` : t.k === "struct" ? `${t.go}{}` : t.k === "data" || t.k === "dref" ? "abap.Data{}"
    : t.k === "d" ? `"00000000"` : t.k === "t" ? `"000000"` : t.k === "p" ? JSON.stringify(pZero(t)) : t.k === "n" ? JSON.stringify("0".repeat(t.len)) : "nil");

/*
 * ABAP tables are values: an assignment copies them, deep, with the tables
 * inside a structure (measured on A4H: lt_b = lt_a then MODIFY lt_b leaves
 * lt_a alone, and the same for a table inside a copied structure). A Go
 * slice is a reference, so every move of a table out of a place goes
 * through a generated clone. Flat values need none.
 */
const composite = (t) => t?.k === "table" || t?.k === "struct";
const byRef = (p) => p.dir === "importing" && composite(p.type) && !p.byValue;
let CLONES = new Map();
// classes some compiled class inherits from: a reference to one is the Go
// interface I_<class>, so it can hold any subclass; a leaf class stays *T
let POLY = new Set();
let CLASSES = new Map();
let EVENTS = new Map();
// descriptors of the types generic data binds to, generated at the end
let DESCS = new Map();
let STRUCTDEFS = new Map();
function needsCopy(t) {
  if (t?.k === "table") return true;
  if (t?.k === "struct") return (STRUCTDEFS.get(t.go)?.fields ?? []).some((f) => needsCopy(f.type));
  return false;
}
function cloneName(t) {
  const key = goType(t);
  if (!CLONES.has(key)) CLONES.set(key, {name: `clone_${CLONES.size}`, type: t});
  return CLONES.get(key).name;
}
const PLACES = new Set(["var", "attr", "static", "field", "fs", "row", "refattr"]);
/** a value moved out of a place: a table (or a structure holding one) is copied */
function copied(text, t, e) {
  return needsCopy(t) && (e === undefined || PLACES.has(e.e)) ? `${cloneName(t)}(${text})` : text;
}
const descKey = (t) => (t.k === "struct" ? `s:${t.go}` : t.k === "table" ? `t${t.sorted ? "s" : t.hashed ? "h" : ""}:${descKey(t.row)}`
  : `${t.k}:${t.len ?? ""}:${t.dec ?? ""}:${t.name ?? ""}`);
/** the descriptor of a type, for generic data: built-in for elementary types, generated for the rest */
function desc(t) {
  switch (t.k) {
    case "i": return "abap.TI";
    case "int8": return "abap.TInt8";
    case "f": return "abap.TF";
    case "string": return "abap.TString";
    case "xstring": return "abap.TXString";
    case "c": return `abap.TC(${t.len ?? 0})`;
    case "x": return `abap.TX(${t.len ?? 0})`;
    case "d": return "abap.TD";
    case "p": return `abap.TP(${t.len ?? 8}, ${t.dec ?? 0})`;
    case "t": return "abap.TT";
    case "n": return `abap.TN(${t.len})`;
    case "dref": return "abap.TRef";
    case "ref": case "exc": return "abap.TObj";
    case "struct": case "table": {
      // the ABAP type, not the Go one: a table of c 200 and a table of string
      // are both []string in Go but not one descriptor (ultra/events: STRING_TO_TAB
      // read the rows of a c 200 table as strings); a SORTED or HASHED table
      // has no Append
      const key = descKey(t);
      if (!DESCS.has(key)) DESCS.set(key, {name: `td_${DESCS.size}`, type: t});
      return DESCS.get(key).name;
    }
    default: throw new Error(`no descriptor for ${t.k}`);
  }
}
function descFuncs() {
  const out = [];
  const done = new Set();
  const inits = [];
  for (let again = true; again;) {
    again = false;
    for (const [key, d] of [...DESCS]) {
      if (done.has(key)) continue;
      done.add(key);
      again = true;
      const t = d.type;
      out.push(`var ${d.name} = &abap.Type{}`);
      if (t.k === "table") {
        const g = goType(t);
        inits.push(`\t*${d.name} = abap.Type{Kind: 'h', Row: ${desc(t.row)}, Lines: func(p any) int { return len(*p.(*${g})) }, At: func(p any, i int) any { return &(*p.(*${g}))[i] }, ${t.hashed || t.sorted ? "" : `Append: func(p any) any { *p.(*${g}) = append(*p.(*${g}), ${zero(t.row)}); return &(*p.(*${g}))[len(*p.(*${g}))-1] }, Delete: func(p any, i int) { *p.(*${g}) = append((*p.(*${g}))[:i], (*p.(*${g}))[i+1:]...) }, `}${copyZero(t)}}`);
      } else {
        const fs = STRUCTDEFS.get(t.go)?.fields ?? [];
        // a structure with a string, a table or a reference in it is deep: 'v' (A4H)
        inits.push(`\t*${d.name} = abap.Type{Kind: '${deepType(t) ? "v" : "u"}', Comps: []abap.Comp{${fs.map((f) => `{Name: ${JSON.stringify(String(f.name).toUpperCase())}, T: ${desc(f.type)}, Get: func(p any) any { return &p.(*${t.go}).${ident(f.name)} }}`).join(", ")}}, ${copyZero(t)}}`);
      }
    }
  }
  if (out.length === 0) return [];
  return [...out, "", "func init() {", ...inits, "}", ""];
}

/**
 * The table registry (frontend tableRegistry, go/abap tables.go): every
 * TABL and DDIC view with its columns, key and client flag, and the
 * descriptors of a row and of a STANDARD TABLE of rows where the row type
 * is in the subset
 */
function tableRegistry(program) {
  const tables = program.tables ?? [];
  if (tables.length === 0) return [];
  const irType = (t) => (t === null ? "nil" : `&abap.IRType{Abap: ${JSON.stringify(t.abap)}${t.len ? `, Len: ${t.len}` : ""}${t.dec ? `, Dec: ${t.dec}` : ""}}`);
  const lines = tables.map((t) => {
    const cols = t.columns.map((c) => `{Name: ${JSON.stringify(c.name)}, Kind: '${c.kind}', Len: ${c.len}, Dec: ${c.dec}, Key: ${c.key}, IR: ${irType(c.type)}}`);
    const types = t.row ? `Row: ${desc(t.row)}, Rows: ${desc({k: "table", row: t.row})}` : `Why: ${JSON.stringify(t.why)}`;
    return `\t\t&abap.Table{Name: ${JSON.stringify(t.name)}, View: ${t.view}, Client: ${t.client}, Key: []string{${t.key.map((k) => JSON.stringify(k)).join(", ")}}, Columns: []abap.Column{${cols.join(", ")}}, ${types}${t.sqlView ? `, SQLView: ${JSON.stringify(t.sqlView)}` : ""}${t.cds ? `, CDS: ${JSON.stringify(t.cds)}` : ""}${t.hidesClient ? `, HidesClient: ${JSON.stringify(t.hidesClient)}` : ""}},`;
  });
  const names = program.ddicNames ?? [];
  return ["func init() {", "	abap.RegisterTables(", ...lines, "	)",
    ...(names.length ? [`	abap.RegisterDDICNames(${names.map((n) => JSON.stringify(n)).join(", ")})`] : []), "}", ""];
}

/** a structure that holds a string, a table or a reference, at any depth */
export function deepType(t) {
  if (["string", "xstring", "table", "ref", "exc", "dref", "data"].includes(t?.k)) return true;
  if (t?.k === "struct") return (STRUCTDEFS.get(t.go)?.fields ?? []).some((f) => deepType(f.type));
  return false;
}

/** the Copy, Zero and New of a generated descriptor: a whole move, a CLEAR
 * and a CREATE DATA through generic data */
function copyZero(t) {
  const g = goType(t);
  return `Copy: func(dst, src any) { *dst.(*${g}) = ${copied(`*src.(*${g})`, t)} }, Zero: func(p any) { *p.(*${g}) = ${zero(t)} }, New: func() any { p := new(${g}); *p = ${zero(t)}; return p }`;
}

/** a structure with a d, t or n field somewhere (and nothing IsInitialData cannot read) */
function typedZeroInside(t, seen = new Set()) {
  if (seen.has(t.go)) return false;
  seen.add(t.go);
  const fs = STRUCTDEFS.get(t.go)?.fields ?? [];
  if (fs.some((f) => ["ref", "exc", "data", "dref"].includes(f.type.k))) return false;
  let found = false;
  for (const f of fs) {
    if (["d", "t", "n"].includes(f.type.k)) found = true;
    else if (f.type.k === "struct") {
      const inner = STRUCTDEFS.get(f.type.go)?.fields ?? [];
      if (inner.some((g) => ["ref", "exc", "data", "dref"].includes(g.type.k))) return false;
      if (typedZeroInside(f.type, seen)) found = true;
    }
  }
  return found;
}

function cloneFuncs() {
  const out = [];
  const done = new Set();
  for (let again = true; again;) {
    again = false;
    for (const [key, c] of [...CLONES]) {
      if (done.has(key)) continue;
      done.add(key);
      again = true;
      const t = c.type;
      if (t.k === "table") {
        const inner = needsCopy(t.row) ? `for i := range v {\n\t\tr[i] = ${cloneName(t.row)}(v[i])\n\t}` : "copy(r, v)";
        out.push(`func ${c.name}(v ${goType(t)}) ${goType(t)} {`, "\tif v == nil {", "\t\treturn nil", "\t}", `\tr := make(${goType(t)}, len(v))`, `\t${inner}`, "\treturn r", "}", "");
      } else {
        const fs = STRUCTDEFS.get(t.go).fields.filter((f) => needsCopy(f.type));
        out.push(`func ${c.name}(v ${goType(t)}) ${goType(t)} {`, ...fs.map((f) => `\tv.${ident(f.name)} = ${cloneName(f.type)}(v.${ident(f.name)})`), "\treturn v", "}", "");
      }
    }
  }
  return out;
}

export function emitGo(program, pkg = "main") {
  const classes = Array.isArray(program) ? program : program.classes;
  const structs = Array.isArray(program) ? new Map() : program.structs;
  CLONES = new Map();
  DESCS = new Map();
  STRUCTDEFS = structs;
  CLASSES = new Map(classes.map((c) => [c.name, c]));
  POLY = new Set(classes.map((c) => c.super).filter(Boolean));
  EVENTS = Array.isArray(program) ? new Map() : (program.events ?? new Map());
  const consts = Array.isArray(program) ? new Map() : program.consts;
  const out = [];
  out.push("// Code generated by tools/gogen/emit-go.mjs. DO NOT EDIT.", "", `package ${pkg}`, "", "import (",
    "\t\"math\"", "\t\"runtime/debug\"", "\t\"sort\"", "\t\"strings\"", "", "\t\"osg/gogen/abap\"", ")", "", "var _ = math.Sin", "var _ = debug.Stack", "var _ = sort.Ints", "var _ strings.Builder", "var _ = abap.AddI", "");
  for (const st of structs.values()) {
    out.push(`type ${st.go} struct {`);
    for (const f of st.fields) out.push(`\t${ident(f.name)} ${goType(f.type)}`);
    out.push("}", "");
  }
  for (const c of consts.values()) out.push(`var ${c.go} ${goType(c.type)} = ${constLiteral(c)}`);
  if (consts.size > 0) out.push("");
  // interfaces used as reference types, and classes referred to but not compiled
  for (const [name, sigs] of program.interfaceMethods ?? []) {
    out.push(`type ${typeName(name)} interface {`);
    for (const m of sigs) if (definable(program, m)) out.push(`\t${signature({name}, m, true)}`);
    out.push(...intfAccessors(program, name));
    out.push("}", "");
  }
  // ultra/events: the parameters of each event used, as one struct a
  // RAISE EVENT builds per handler call
  for (const ev of EVENTS.values()) {
    out.push(`type ${evType(ev.key)} struct {`);
    for (const p of ev.params) out.push(`\t${ident(p.name)} ${goType(p.type)}`);
    out.push("}", "");
  }
  const compiled = new Set(classes.map((c) => c.name));
  for (const ref of referencedClasses(program)) if (!compiled.has(ref)) out.push(`type ${typeName(ref)} struct{}`, "");
  for (const cls of classes) {
    const inst = (cls.attributes ?? []).filter((a) => !a.static && !a.unsupported);
    out.push(`type ${typeName(cls.name)} struct {`);
    // the superclass's part of the object, embedded: its attributes and
    // methods are promoted, and a redefinition shadows the method
    if (cls.super) out.push(`\t${typeName(cls.super)}`);
    // the most-derived object, for the calls a method makes on me
    if (POLY.has(cls.name)) out.push(`\tself_${typeName(cls.name)} I_${typeName(cls.name)}`);
    // ultra/events: an object that raises instance events carries the
    // handlers registered FOR it (go/abap/events.go); once per chain, the
    // subclasses get it through the embedding
    if (cls.instanceEvents && !(cls.super && CLASSES.get(cls.super)?.instanceEvents)) out.push("\tabap.Events");
    for (const a of inst) out.push(`\t${ident(a.name)} ${goType(a.type)}`);
    // ultra/events: an object of a class without fields would be zero-sized,
    // and Go may give two of them one address: ref <> ref and the handler
    // registry need each object to be itself
    if (out.at(-1) === `type ${typeName(cls.name)} struct {`) out.push("\t_ byte");
    out.push("}", "");
    if (POLY.has(cls.name)) out.push(...classInterface(program, cls));
    out.push(...attrAccessors(cls, inst));
    for (const a of (cls.attributes ?? []).filter((x) => x.static && !x.unsupported)) {
      out.push(`var ${typeName(`${cls.name}=>${a.name}`)} ${goType(a.type)}${a.value === undefined ? "" : ` = ${constLiteral(a)}`}`);
    }
    if (chainCctor(cls)) {
      const sup = cls.super && CLASSES.get(cls.super) && chainCctor(CLASSES.get(cls.super)) ? `\tEnsure_${typeName(cls.super)}(s)` : null;
      out.push(`var cctor_${typeName(cls.name)} bool`, "", `func Ensure_${typeName(cls.name)}(s *abap.Session) {`, `\tif cctor_${typeName(cls.name)} {`, "\t\treturn", "\t}",
        // ultra/events (fix round): an exception out of it is a runtime
        // error (abap.CctorGuard, A4H ZCL_GOGEN_T_CCBOOM2)
        `\tcctor_${typeName(cls.name)} = true`, `\tdefer abap.CctorGuard(${JSON.stringify(cls.name)}, &cctor_${typeName(cls.name)})`, ...(sup ? [sup] : []), ...(ownCctor(cls) ? [`\t${funcName(cls.name, "CLASS_CONSTRUCTOR")}(s)`] : []), "}", "");
    }
    for (const m of cls.methods) out.push(...method(cls, m), "");
    // a method that did not compile still exists, and says why when called
    for (const m of cls.stubs ?? []) {
      if (m.name === "CONSTRUCTOR" || !definable(program, m)) continue;
      out.push(`${signature(cls, m)} {`, `\tpanic(abap.NotCompiled(${JSON.stringify(`${cls.name}=>${m.name}`)}, ${JSON.stringify(m.reason)}))`, "}", "");
    }
    if (cls.constructor) out.push(...method(cls, {...cls.constructor, name: "CONSTRUCTOR", static: false}), "");
    if (cls.abstract) continue;
    // NEW: a new object, every level's attributes set, every level's self
    // pointing at it, then the nearest constructor of the chain
    const chain = [cls];
    for (let c = cls; c.super && CLASSES.has(c.super);) { c = CLASSES.get(c.super); chain.push(c); }
    const ctorAt = chain.find((c) => c.constructor || c.ctorParams);
    const cp = ctorAt ? (ctorAt.constructor?.params ?? ctorAt.ctorParams ?? []) : [];
    // Alloc_: the object without its constructor, for the host (RTTI builds
    // descriptors the way the kernel does, field by field)
    out.push(`func Alloc_${typeName(cls.name)}() *${typeName(cls.name)} {`,
      `\to := &${typeName(cls.name)}{}`,
      ...chain.flatMap((c) => (c.attributes ?? []).filter((a) => !a.static && !a.unsupported && a.value !== undefined).map((a) => `\to.${ident(a.name)} = ${constLiteral(a)}`)),
      ...chain.filter((c) => POLY.has(c.name)).map((c) => `\to.self_${typeName(c.name)} = o`),
      "\treturn o", "}", "");
    out.push(`func New_${typeName(cls.name)}(${["s *abap.Session", ...cp.map((p) => `${ident(p.name)} ${byRef(p) ? "*" : ""}${goType(p.type)}`)].join(", ")}) *${typeName(cls.name)} {`,
      ...(chainCctor(cls) ? [`\tEnsure_${typeName(cls.name)}(s)`] : []),
      `\to := Alloc_${typeName(cls.name)}()`,
      ...(ctorAt?.constructor ? [`\to.CONSTRUCTOR(${["s", ...cp.map((p) => ident(p.name))].join(", ")})`] : []),
      "\treturn o", "}", "");
    // CREATE OBJECT ... TYPE (name) passes no arguments
    const make = cp.length === 0 ? `return New_${typeName(cls.name)}(s)`
      : `panic(abap.NotCompiled(${JSON.stringify(`${cls.name}=>CONSTRUCTOR`)}, "CREATE OBJECT by name of a class whose constructor has parameters"))`;
    out.push(`func init() {`, `\tabap.RegisterClass(${JSON.stringify(cls.name)}, (*${typeName(cls.name)})(nil), func(s *abap.Session) any { ${make} })`, "}", "");
  }
  out.push(...exceptionSupers(program));
  out.push(...dispatcher(classes));
  out.push(...staticRegistry(program, classes));
  if (classes.some((c) => c.methods.some((m) => m.body?.[0]?.fn === "Native_DESCRIBE_BY_NAME"))) out.push(...nativeRtti(program));
  if (classes.some((c) => c.methods.some((m) => m.body?.[0]?.fn === "Native_GET_TEXT_FOR_MESSAGE"))) out.push(...nativeMessageText(program));
  out.push(...nativeCodepage(classes));
  out.push(...tableRegistry(program));
  // descriptors first: their Copy asks for clone functions
  const descs = descFuncs();
  out.push(...cloneFuncs());
  out.push(...descs);
  // a RESET line becomes a //line back to this file at the line after it
  for (let i = 0; i < out.length; i += 1) if (out[i] === RESET) out[i] = `//line zz_generated.go:${i + 2}`;
  return out.join("\n") + "\n";
}

/**
 * CL_MESSAGE_HELPER=>GET_TEXT_FOR_MESSAGE, which open-abap writes as kernel
 * code: an exception object that is no IF_T100_MESSAGE and has no text id
 * has the fallback text (A4H gives the same for such a class, 2026-09-23);
 * a T100 message or an OTR text id is not read here and dumps.
 */
function nativeMessageText(program) {
  const head = `func Native_GET_TEXT_FOR_MESSAGE(s *abap.Session, text ${goType({k: "ref", name: "IF_MESSAGE", intf: true})}) string {`;
  const root = CLASSES.get("CX_ROOT");
  // IF_T100_MESSAGE has no methods, so every Go value fits its interface:
  // the classes that implement it are told by name
  const t100 = [...CLASSES.values()].filter((c) => [c, ...ancestorsOf(c)].some((x) => (x.interfaces ?? []).includes("IF_T100_MESSAGE"))).map((c) => c.name);
  return [head, "\tif text == nil {", `\t\tpanic(abap.NotCompiled("CL_MESSAGE_HELPER=>GET_TEXT_FOR_MESSAGE", "an initial reference"))`, "\t}",
    ...(t100.length ? [`\tswitch abap.ClassOf(text) {`, `\tcase ${t100.map((x) => JSON.stringify(x)).join(", ")}:`, `\t\tpanic(abap.NotCompiled("CL_MESSAGE_HELPER=>GET_TEXT_FOR_MESSAGE", "T100 message texts are not read in the Go host"))`, "\t}"] : []),
    ...(root && POLY.has("CX_ROOT") && root.attributes.some((a) => a.name === "TEXTID" && !a.unsupported)
      ? [`\tif x, ok := any(text).(I_CX_ROOT); !ok || x.As_CX_ROOT().${ident("TEXTID")} != "" {`, `\t\tpanic(abap.NotCompiled("CL_MESSAGE_HELPER=>GET_TEXT_FOR_MESSAGE", "OTR texts are not read in the Go host"))`, "\t}"]
      : [`\tpanic(abap.NotCompiled("CL_MESSAGE_HELPER=>GET_TEXT_FOR_MESSAGE", "CX_ROOT is not compiled"))`]),
    `\treturn "An exception was raised."`, "}", ""];
}

/*
 * cl_abap_conv_out_ce->convert and cl_abap_conv_in_ce->convert, kernel code
 * in open-abap: text to bytes and back in the encoding create( ) chose
 * (mv_js_encoding: utf8 or utf16le / utf-16le). The work is abap.EncodeText /
 * abap.DecodeText; N and bytes that are no valid text are refused, not guessed.
 */
function nativeCodepage(classes) {
  const out = [];
  const has = (fn) => classes.some((c) => c.methods.some((m) => m.body?.[0]?.fn === fn));
  const sup = (cls, meth, p) => classes.find((c) => c.name === cls)?.methods.find((m) => m.name === meth)?.params.some((x) => x.name === p);
  if (has("Native_CONV_OUT_CONVERT")) {
    const withSup = sup("CL_ABAP_CONV_OUT_CE", "CONVERT", "SUP_N");
    out.push(`func Native_CONV_OUT_CONVERT(s *abap.Session, me *CL_ABAP_CONV_OUT_CE, data string, n int32, buffer *string${withSup ? ", sup_n string" : ""}) {`,
      ...(withSup ? ["\tif sup_n != \"\" {", "\t\tdata = abap.SubS(data, 0, n)", "\t}"] : ["\tif n != 0 {", `\t\tpanic(abap.NotCompiled("CL_ABAP_CONV_OUT_CE=>CONVERT", "N given"))`, "\t}"]),
      `\t*buffer = abap.EncodeText(me.${ident("MV_JS_ENCODING")}, data)`, "}", "");
  }
  if (has("Native_CONV_IN_CONVERT")) {
    const withSup = sup("CL_ABAP_CONV_IN_CE", "CONVERT", "SUP_N");
    out.push(`func Native_CONV_IN_CONVERT(s *abap.Session, me *CL_ABAP_CONV_IN_CE, input string, n int32, data *string${withSup ? ", sup_n string" : ""}) {`,
      "\tif n != 0 {", `\t\tpanic(abap.NotCompiled("CL_ABAP_CONV_IN_CE=>CONVERT", "N given (open-abap ignores it)"))`, "\t}",
      `\t*data = abap.DecodeText(me.${ident("MV_JS_ENCODING")}, me.${ident("MV_IGNORE_CERR")} != "", input)`, "}", "");
  }
  return out;
}

/*
 * Class-based exceptions: a CATCH takes a runtime exception of a class it
 * covers (decided by the front end) or a raised object whose class is one
 * of the names or inherits from one (decided at run time, over the table of
 * superclasses below). INTO receives the object itself, or, for a CATCH
 * that also covers runtime exceptions, an exception value.
 */
function catchCond(c) {
  const rt = c.covers.map((x) => `xE.Class == ${JSON.stringify(x)}`);
  const own = c.own.map((x) => `abap.IsA(xRX.Class, ${JSON.stringify(x)})`);
  const parts = [];
  if (rt.length) parts.push(`(xOK && (${rt.join(" || ")}))`);
  if (own.length) parts.push(`(xROK && (${own.join(" || ")}))`);
  return parts.length ? parts.join(" || ") : "false";
}

function catchInto(c, t) {
  if (!c.into) return [];
  const v = ident(c.into);
  if (c.intoKind === "ref") return [`${t}\t\t\t\t${v} = abap.Cast[${goType(c.intoType)}](xRX.Obj)`];
  if (!c.own.length) return [`${t}\t\t\t\t${v} = &abap.Exception{Class: xE.Class, Op: xE.Op}`];
  return [`${t}\t\t\t\tif xROK {`, `${t}\t\t\t\t\t${v} = &abap.Exception{Class: xRX.Class, Obj: xRX.Obj}`, `${t}\t\t\t\t} else {`,
    `${t}\t\t\t\t\t${v} = &abap.Exception{Class: xE.Class, Op: xE.Op}`, `${t}\t\t\t\t}`];
}

function exceptionSupers(program) {
  const m = Object.entries(program.exceptionSupers ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (m.length === 0) return [];
  return ["func init() {", "\tabap.RegisterSupers(map[string]string{", ...m.map(([k, v]) => `\t\t${JSON.stringify(k)}: ${JSON.stringify(v)},`), "\t})", "}", ""];
}

/**
 * describe_by_name for the Go host: a structure of the dictionary or a class's
 * TYPES becomes a CL_ABAP_STRUCTDESCR whose components are CL_ABAP_ELEMDESCRs
 * carrying the type kind, built from the same generated classes the ABAP
 * around it uses, so get_components( ) and ?= work as written. A name the
 * registry has that is not a structure (a class, a data element) dumps; a
 * name nobody has is TYPE_NOT_FOUND, as on a system.
 */
function nativeRtti(program) {
  const sd = CLASSES.get("CL_ABAP_STRUCTDESCR");
  const ed = CLASSES.get("CL_ABAP_ELEMDESCR");
  const comp = sd?.attributes.find((a) => a.name === "MT_REFS_COMP");
  const ret = goType({k: "ref", name: "CL_ABAP_TYPEDESCR"});
  const head = `func Native_DESCRIBE_BY_NAME(s *abap.Session, p_name string) ${ret} {`;
  if (!sd || !ed || !comp || comp.unsupported || sd.abstract || ed.abstract) {
    return [head, `\tpanic(abap.NotCompiled("CL_ABAP_TYPEDESCR=>DESCRIBE_BY_NAME", "RTTI needs CL_ABAP_STRUCTDESCR and CL_ABAP_ELEMDESCR compiled"))`, "}", ""];
  }
  const has = (cls, a) => [cls, ...ancestorsOf(cls)].some((c) => c.attributes?.some((x) => x.name === a && !x.unsupported && !x.static));
  const set = (cls, v, a, val) => (has(cls, a) ? [`\t${v}.${ident(a)} = ${val}`] : []);
  const out = ["// the structures RTTI can describe: name -> components (name, type kind)", "var rttiStructs = map[string][][2]string{"];
  for (const [n, cs] of [...program.rtti.structs].sort()) out.push(`\t${JSON.stringify(n)}: {${cs.map((c) => `{${JSON.stringify(c.name)}, ${JSON.stringify(c.kind)}}`).join(", ")}},`);
  out.push("}", "", "var rttiKnown = map[string]bool{", ...[...program.rtti.known].sort().map((n) => `\t${JSON.stringify(n)}: true,`), "}", "");
  const row = comp.type.row.go;
  out.push(head, `\tname := strings.ToUpper(strings.TrimRight(p_name, " "))`, "\tfields, ok := rttiStructs[name]", "\tif !ok {",
    "\t\tif rttiKnown[name] {", `\t\t\tpanic(abap.NotCompiled("CL_ABAP_TYPEDESCR=>DESCRIBE_BY_NAME", "RTTI in the Go host describes structures only: "+name))`, "\t\t}",
    `\t\tpanic(abap.ClassicException{Name: "TYPE_NOT_FOUND", Method: "DESCRIBE_BY_NAME"})`, "\t}",
    "\td := Alloc_CL_ABAP_STRUCTDESCR()",
    ...set(sd, "d", "KIND", `"S"`), ...set(sd, "d", "TYPE_KIND", `"u"`), ...set(sd, "d", "RELATIVE_NAME", "name"),
    ...set(sd, "d", "ABSOLUTE_NAME", "`\\TYPE=` + name"), ...set(sd, "d", "DDIC", `"X"`),
    "\tfor _, f := range fields {", "\t\te := Alloc_CL_ABAP_ELEMDESCR()",
    ...set(ed, "e", "KIND", `"E"`).map((l) => `\t${l}`), ...set(ed, "e", "TYPE_KIND", "f[1]").map((l) => `\t${l}`), ...set(ed, "e", "RELATIVE_NAME", "f[0]").map((l) => `\t${l}`),
    `\t\tc := ${row}{}`, "\t\tc.name = f[0]", "\t\tc.type_ = e",
    "\t\td.mt_refs_comp = append(d.mt_refs_comp, c)",
    ...(has(sd, "MT_REFS") ? ["\t\td.mt_refs = append(d.mt_refs, c)"] : []), "\t}", "\treturn d", "}", "");
  return out;
}

/**
 * CALL METHOD (class)=>m: every compiled class is known by name, and each
 * static method whose name some dynamic call uses gets an adapter that reads
 * its arguments out of generic data by name. A class the registry has but the
 * program did not compile dumps instead of passing for an unknown one.
 */
function staticRegistry(program, classes) {
  const wanted = program.dynStatics ?? new Set();
  if (wanted.size === 0) return [];
  const out = ["func init() {", `\tabap.KnownClasses(${goStrings(classes.map((c) => c.name))}, ${goStrings([...(program.rtti?.known ?? [])].filter((n) => !n.includes("=>")))})`];
  for (const cls of classes) {
    for (const m of [...cls.methods, ...(cls.stubs ?? [])]) {
      if (!m.static || !wanted.has(m.name) || !definable(program, m)) continue;
      const lines = [];
      const args = m.params.map((p, i) => {
        const v = `v${i}`;
        if (p.dir !== "importing") { lines.push(`\t\t${v} := new(${goType(p.type)})`); return v; }
        if (p.suppliedOf) { lines.push(`\t\t${v} := ""`, `\t\tif _, ok := a[${JSON.stringify(p.suppliedOf)}]; ok {`, `\t\t\t${v} = "X"`, `\t\t}`); return v; }
        const read = (d) => (["i", "string", "c", "d", "t"].includes(p.type.k) ? unwrapTo(p.type, d)
          : p.type.k === "data" ? d : byRef(p) ? `${d}.P.(*${goType(p.type)})` : `*${d}.P.(*${goType(p.type)})`);
        const absent = p.optional && p.default === undefined ? zero(p.type)
          : `func() ${byRef(p) ? "*" : ""}${goType(p.type)} { panic(abap.ArithmeticError{Class: "CX_SY_DYN_CALL_PARAM_MISSING", Op: ${JSON.stringify(`${cls.name}=>${m.name} ${p.name}`)}}) }()`;
        lines.push(`\t\tvar ${v} ${byRef(p) ? "*" : ""}${goType(p.type)}`, `\t\tif d, ok := a[${JSON.stringify(p.name)}]; ok {`, `\t\t\t${v} = ${read("d")}`, `\t\t} else {`,
          `\t\t\t${v} = ${byRef(p) && p.optional && p.default === undefined ? `new(${goType(p.type)})` : absent}`, `\t\t}`);
        return v;
      });
      out.push(`\tabap.RegisterStatic(${JSON.stringify(`${cls.name}=>${m.name}`)}, ${goStrings(m.params.filter((p) => p.dir === "importing").map((p) => p.name))}, func(s *abap.Session, a map[string]abap.Data) {`,
        ...lines, `\t\t${funcName(cls.name, m.name)}(${["s", ...args].join(", ")})`, "\t})");
    }
  }
  out.push("}", "");
  return out;
}

const goStrings = (xs) => `[]string{${xs.map((x) => JSON.stringify(x)).join(", ")}}`;

function ancestorsOf(cls) {
  const out = [];
  for (let c = cls; c.super && CLASSES.has(c.super);) { c = CLASSES.get(c.super); out.push(c); }
  return out;
}

/**
 * I_<class>: what a reference to a class with subclasses can call. It embeds
 * the superclass's interface, adds the class's own public and protected
 * instance methods, and As_<class>, which gives the class's part of the
 * object (its attributes) and keeps an unrelated class with the same methods
 * from fitting.
 */
function classInterface(program, cls) {
  const T = typeName(cls.name);
  const out = [`type I_${T} interface {`];
  if (cls.super && POLY.has(cls.super)) out.push(`\tI_${typeName(cls.super)}`);
  out.push(`\tAs_${T}() *${T}`);
  // the accessors of the interfaces the class implements, so the reference converts to them
  for (const a of (cls.attributes ?? []).filter((x) => x.fromIntf && !x.unsupported)) out.push(`\t${accessorName(a.name)}() *${goType(a.type)}`);
  for (const m of cls.signatures?.values() ?? []) {
    if (m.unsupported || m.static || m.private || m.name === "CONSTRUCTOR" || !definable(program, m)) continue;
    out.push(`\t${signature({name: cls.name}, m, true)}`);
  }
  out.push("}", "", `func (me *${T}) As_${T}() *${T} { return me }`, "");
  return out;
}

/*
 * An interface's DATA through a reference to the interface: a Go interface
 * has no fields, so it carries one accessor per attribute, a pointer to the
 * object's own field, and every class that implements the interface gives
 * it. A read is *p, a write *p = v; both reach the object.
 */
const accessorName = (attr) => `Ptr_${typeName(attr)}`;

function intfAccessors(program, intf) {
  return (program.interfaceAttrs?.get(intf) ?? []).filter((a) => !a.static && !a.unsupported && definable(program, {params: [{type: a.type}]}))
    .map((a) => `\t${accessorName(a.name)}() *${goType(a.type)}`);
}

function attrAccessors(cls, inst) {
  const out = inst.filter((a) => a.fromIntf).map((a) => `func (me *${typeName(cls.name)}) ${accessorName(a.name)}() *${goType(a.type)} { return &me.${ident(a.name)} }`);
  return out.length ? [...out, ""] : [];
}

/** a signature whose every type is declared in this program */
export function definable(program, m) {
  const ok = (t) => {
    if (!t) return true;
    if (t.k === "struct") return program.structs.has(t.go);
    if (t.k === "table") return ok(t.row);
    if (t.k === "ref") return t.name === "OBJECT" || (t.intf ? program.interfaceMethods?.has(t.name) : true);
    return true;
  };
  return m.params.every((p) => ok(p.type)) && ok(m.returning?.type);
}

export function referencedClasses(program) {
  const seen = new Set();
  const visit = (t) => {
    if (!t) return;
    if (t.k === "ref" && !t.intf) seen.add(t.name);
    if (t.k === "table") visit(t.row);
  };
  for (const st of program.structs?.values() ?? []) st.fields.forEach((f) => visit(f.type));
  for (const c of program.classes ?? []) {
    (c.attributes ?? []).forEach((a) => visit(a.type));
    [...c.methods, ...(c.stubs ?? []), ...(c.constructor ? [c.constructor] : [])].forEach((m) => {
      m.params?.forEach((p) => visit(p.type)); visit(m.returning?.type); m.locals?.forEach((l) => visit(l.type));
    });
  }
  for (const sigs of program.interfaceMethods?.values() ?? []) sigs.forEach((m) => { m.params.forEach((p) => visit(p.type)); visit(m.returning?.type); });
  return seen;
}

/** the bytes of an x literal written as hex text, padded or cut to its length */
export function hexBytes(text, len) {
  const b = (String(text).match(/[0-9a-fA-F]{2}/g) ?? []).map((h) => parseInt(h, 16));
  if (len === undefined) return b;
  return b.length >= len ? b.slice(0, len) : [...b, ...new Array(len - b.length).fill(0)];
}

function constLiteral(c) {
  // a structured constant: its components, an unset one initial
  if (c.type.k === "struct") {
    const fields = STRUCTDEFS.get(c.type.go)?.fields ?? [];
    return `${c.type.go}{${fields.map((f) => `${ident(f.name)}: ${c.value[f.name] === undefined ? zero(f.type) : constLiteral({type: f.type, value: c.value[f.name]})}`).join(", ")}}`;
  }
  if (c.type.k === "i") return String(Number(c.value));
  // int8: the digits as written, a JS number would round 9223372036854775807
  if (c.type.k === "int8") return String(BigInt(String(c.value).trim()));
  if (c.type.k === "f") return String(Number(c.value));
  if (c.type.k === "n") return JSON.stringify(String(c.value));
  if (c.type.k === "string" || c.type.k === "c") return JSON.stringify(c.type.k === "c" ? c.value.replace(/ +$/, "") : c.value);
  if (c.type.k === "x" || c.type.k === "xstring") return `"${hexBytes(c.value, c.type.len).map((b) => `\\x${b.toString(16).padStart(2, "0")}`).join("")}"`;
  throw new Error(`constant of type ${c.type.k}`);
}

function signature(cls, m, inInterface = false) {
  const params = ["s *abap.Session", ...m.params.map((p) => `${ident(p.name)} ${p.dir === "importing" && !byRef(p) ? "" : "*"}${goType(p.type)}`)];
  const ret = m.returning ? ` (${ident(m.returning.name)} ${goType(m.returning.type)})` : "";
  if (inInterface) return `${typeName(m.name)}(${params.join(", ")})${ret}`;
  return m.static
    ? `func ${funcName(cls.name, m.name)}(${params.join(", ")})${ret}`
    : `func (me *${typeName(cls.name)}) ${typeName(m.name)}(${params.join(", ")})${ret}`;
}

function method(cls, m) {
  const lines = [...(LINES && m.pos ? [`//line ${m.pos.file}:${m.pos.row}`] : []), `${signature(cls, m)} {`, "\t_ = s"];
  if (m.static && m.name !== "CLASS_CONSTRUCTOR" && chainCctor(cls)) lines.push(`\tEnsure_${typeName(cls.name)}(s)`);
  if (!m.static) lines.push("\t_ = me");
  for (const l of m.locals) lines.push(`\tvar ${ident(l.name)} ${goType(l.type)}`, `\t_ = ${ident(l.name)}`);
  for (const f of m.fieldSymbols ?? []) lines.push(`\tvar ${ident(f.name)} ${f.type.k === "data" ? "" : "*"}${goType(f.type)}`, `\t_ = ${ident(f.name)}`);
  const ctx = {cls, loop: 0, inCtor: m.name === "CONSTRUCTOR", method: m};
  lines.push(...m.body.flatMap((st) => stmt(st, ctx, 1)));
  lines.push("\treturn", "}");
  if (LINES && m.pos) lines.push(RESET);
  return lines;
}

const tab = (n) => "\t".repeat(n);

/**
 * who a call on me goes to. In a class with subclasses a public or protected
 * method is virtual: through self, the most-derived object. Not in a
 * constructor, though: there ABAP calls the class's own implementation, the
 * subclass's part does not exist yet.
 */
function self(ctx, methodName) {
  if (!POLY.has(ctx.cls.name)) return "me";
  // me as a value is the whole object, in a constructor too (New_ sets self first)
  if (methodName === null) return `me.self_${typeName(ctx.cls.name)}`;
  if (ctx.inCtor || ctx.cls.signatures?.get(methodName)?.private) return "me";
  return `me.self_${typeName(ctx.cls.name)}`;
}

/**
 * RETURN (1), EXIT (2) or CONTINUE (3) where it stands: inside a TRY's
 * closure it is a code for the closure to hand out (from a CATCH, which runs
 * in the deferred function, by setting the code); EXIT and CONTINUE belong to
 * the innermost loop, so only one outside the TRY makes them leave it; EXIT
 * outside any loop leaves the method, as in ABAP
 */
function leave(ctx, code) {
  const top = ctx.tries?.at(-1);
  const escapes = top && (code === 1 || (ctx.loopLevel ?? 0) === top.level);
  if (escapes) {
    const c = code !== 1 && top.level === 0 ? 1 : code;
    top.used.add(c);
    return top.mode === "body" ? `return ${c}` : `ctl = ${c}; return`;
  }
  if (code === 1 || (ctx.loopLevel ?? 0) === 0) return "return";
  return code === 2 ? "break" : "continue";
}

/** an IMPORTING argument: a composite by reference goes as a pointer, by VALUE as a clone */
function importingArg(a, ctx) {
  if (a.byValue === undefined || !composite(a.type)) return expr(a.value, ctx);
  if (!a.byValue) return PLACES.has(a.value.e) ? `&${place(a.value, ctx)}` : `abap.Ptr(${expr(a.value, ctx)})`;
  return copied(expr(a.value, ctx), a.value.type, a.value);
}

function place(p, ctx) {
  switch (p.e) {
    case "var": return p.ref ? `(*${ident(p.name)})` : ident(p.name);
    case "attr": return `me.${ident(p.name)}`;
    case "static": return p.go;
    case "const": return p.go;
    case "field": return `${PLACES.has(p.base.e) || p.base.e === "const" ? place(p.base, ctx) : `(${expr(p.base, ctx)})`}.${ident(p.name)}`;
    case "fs": return p.type.k === "data" ? ident(p.name) : `(*${ident(p.name)})`;
    case "refattr": if (p.base.type.intf) return `(*${expr(p.base, ctx)}.${accessorName(p.name)}())`;
      return POLY.has(p.base.type.name) && !p.base.type.intf ? `${expr(p.base, ctx)}.As_${typeName(p.base.type.name)}().${ident(p.name)}` : `${expr(p.base, ctx)}.${ident(p.name)}`;
    case "row": {
      const b = place(p.base, ctx);
      return `${b}[abap.Idx(len(${b}), ${expr(p.index, ctx)})]`;
    }
    default: throw new Error(`not a place: ${p.e}`);
  }
}

/*
 * v = v && x inside a loop copies all of v on every pass in Go, where V8
 * keeps a rope: a JSON frame of 800 KB built that way cost Go ten times
 * JS. When a loop only ever appends to a local string, the loop gets a
 * strings.Builder for it and writes v back once after the loop.
 */
const leftmost = (e) => { while (e?.e === "concat") e = e.l; return e; };
const isAppend = (st, name) => st?.s === "assign" && st.target.e === "var" && !st.target.ref && st.target.type.k === "string"
  && (name === undefined || st.target.name === name) && st.value.e === "concat" && leftmost(st.value).e === "var" && leftmost(st.value).name === st.target.name;

function builders(body, ctx, outside = []) {
  const names = new Set();
  let exits = false;
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    if (n.s === "return") exits = true;
    if (isAppend(n)) names.add(n.target.name);
    for (const k of Object.keys(n)) if (k !== "type") walk(n[k]);
  };
  walk(body);
  if (exits) return [];
  // ultra/events: a name the loop's own condition (WHILE, LOOP ... WHERE)
  // reads must stay current on every pass: no builder for it (a WHILE
  // strlen( v ) < 32 appending to v never ended, ZCL_OSD_TRAN_SESSION=>NEW_ID)
  const read = new Set();
  const seen = (n) => {
    if (Array.isArray(n)) { n.forEach(seen); return; }
    if (!n || typeof n !== "object") return;
    if (n.e === "var") read.add(n.name);
    for (const k of Object.keys(n)) if (k !== "type") seen(n[k]);
  };
  seen(outside);
  return [...names].filter((name) => !read.has(name) && !ctx.builders?.has(name) && appendsOnly(body, name));
}

function appendsOnly(body, name) {
  let appends = 0;
  let refs = 0;
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    if (n.e === "var" && n.name === name) refs += 1;
    if (isAppend(n, name)) appends += 1;
    for (const k of Object.keys(n)) if (k !== "type") walk(n[k]);
  };
  walk(body);
  return appends > 0 && refs === 2 * appends;
}

/** a loop's lines, wrapped in the builders of the strings it only appends to */
function withBuilders(body, ctx, t, emitLoop, outside = []) {
  const names = builders(body, ctx, outside);
  ctx.builders ??= new Map();
  for (const n of names) ctx.builders.set(n, `sb_${ident(n)}_${ctx.loop++}`);
  const pre = names.flatMap((n) => [`${t}var ${ctx.builders.get(n)} strings.Builder`, `${t}${ctx.builders.get(n)}.WriteString(${ident(n)})`]);
  ctx.loopLevel = (ctx.loopLevel ?? 0) + 1;
  const lines = emitLoop();
  ctx.loopLevel -= 1;
  const post = names.map((n) => `${t}${ident(n)} = ${ctx.builders.get(n)}.String()`);
  for (const n of names) ctx.builders.delete(n);
  return [...pre, ...lines, ...post];
}

/*
 * ABAP positions: every statement carries a line directive (block form) in front
 * of it, so a panic, a stack trace, a pprof profile or delve name the ABAP
 * line, not the generated one. Code that is not ABAP gets its own lines back
 * (the RESET marker, replaced once the file is assembled).
 */
// the arguments of a statement lowered at build time: the logon client, a
// host value (a c right-trimmed, as the column binds it), a literal
function sqlArgs(args, ctx) {
  return `[]any{${args.map((a) => (a.fit !== undefined ? `abap.DBCFit(${expr(a.host, ctx)}, ${a.fit})`
    : a.host ? (a.host.type.k === "c" ? `abap.DBC(${expr(a.host, ctx)})` : expr(a.host, ctx))
    : a.mandt ? "abap.Mandt" : typeof a.value === "number" ? String(a.value) : JSON.stringify(String(a.value)))).join(", ")}}`;
}

const irTypeGo = (t) => `&abap.IRType{Abap: ${JSON.stringify(t.abap)}${t.len !== undefined ? `, Len: ${t.len}` : ""}}`;

// the ranges of a statement: where lower() put each marker, and the rows of
// the ranges table as the Go values of their fields
function hostPreds(preds, ctx) {
  if (!preds || preds.length === 0) return "nil";
  return `[]abap.HostPred{${preds.map((p) => {
    const fields = new Map((STRUCTDEFS.get(p.range.type.row.go)?.fields ?? []).map((f) => [String(f.name).toUpperCase(), f]));
    const v = (nm) => (fields.get(nm).type.k === "i" ? `int64(r.${ident(fields.get(nm).name)})` : `r.${ident(fields.get(nm).name)}`);
    const rows = `func() []abap.RangeRow { out := []abap.RangeRow{}; for _, r := range ${expr(p.range, ctx)} { out = append(out, abap.RangeRow{Sign: r.${ident(fields.get("SIGN").name)}, Option: r.${ident(fields.get("OPTION").name)}, Low: ${v("LOW")}, High: ${v("HIGH")}}) }; return out }()`;
    return `{ID: ${JSON.stringify(p.id)}, After: ${p.after}, Column: ${JSON.stringify(p.column)}, Type: ${irTypeGo(p.type)}, Kind: ${JSON.stringify(p.kind ?? "")}, LowLen: ${p.lowLen}, Rows: ${rows}}`;
  }).join(", ")}}`;
}

const RESET = "\u0000reset-position";
// GOGEN_NOLINE=1 leaves the directives out, for debugging the emitter itself
const LINES = !process.env.GOGEN_NOLINE;
function stmt(st, ctx, d) {
  const lines = stmtLines(st, ctx, d);
  if (LINES && st.pos && lines.length > 0) lines[0] = lines[0].replace(/^(\t*)/, `$1/*line ${st.pos.file}:${st.pos.row}*/ `);
  return lines;
}

function stmtLines(st, ctx, d) {
  const t = tab(d);
  switch (st.s) {
    case "assign":
      if (ctx.builders?.has(st.target.name) && isAppend(st, st.target.name)) {
        const parts = [];
        for (let e = st.value; e.e === "concat"; e = e.l) parts.unshift(e.r);
        return parts.map((x) => `${t}${ctx.builders.get(st.target.name)}.WriteString(${expr(x, ctx)})`);
      }
      return [`${t}${place(st.target, ctx)} = ${copied(expr(st.value, ctx), st.value.type, st.value)}`];
    case "clear":
      return [`${t}${place(st.target, ctx)} = ${zero(st.target.type)}`];
    case "append": {
      const tb = place(st.table, ctx);
      return [`${t}${tb} = append(${tb}, ${copied(expr(st.value, ctx), st.value.type, st.value)})`, `${t}s.Sy.Tabix = int32(len(${tb}))`,
        // ultra/events: APPEND ... ASSIGNING <fs>
        ...(st.fs ? [`${t}${ident(st.fs)} = &${tb}[len(${tb})-1]`] : [])];
    }
    // ultra/events: CONCATENATE [LINES OF] ... INTO t [SEPARATED BY s]
    case "concat": {
      const n = ctx.loop++;
      const sep = st.sep ? expr(st.sep, ctx) : `""`;
      const joined = st.table
        ? `func() string { var b []string; for _, ConcatRow := range ${expr(st.table, ctx)} { b = append(b, ${expr(st.row, ctx)}) }; return strings.Join(b, ${sep}) }()`
        : `strings.Join([]string{${st.parts.map((x) => expr(x, ctx)).join(", ")}}, ${sep})`;
      return [`${t}{`, `${t}	v${n}, rc${n} := abap.ConcatFit(${joined}, ${st.target.type.k === "c" ? st.target.type.len : -1})`,
        `${t}	${place(st.target, ctx)} = v${n}`, `${t}	s.Sy.Subrc = rc${n}`, `${t}}`];
    }
    // ultra/events: FIND ALL OCCURRENCES ... MATCH COUNT n
    case "find_all": {
      const icase = st.icase.e === "flag" ? String(st.icase.value) : `(${expr(st.icase, ctx)} == "X")`;
      return [`${t}${place(st.count, ctx)} = abap.FindAllCount(${expr(st.subject, ctx)}, ${expr(st.pattern, ctx)}, ${st.regex}, ${icase})`,
        `${t}s.Sy.Subrc = 4`, `${t}if ${place(st.count, ctx)} > 0 {`, `${t}	s.Sy.Subrc = 0`, `${t}}`];
    }
    case "read_index": {
      const n = `idx${ctx.loop++}`;
      const tb = expr(st.table, ctx);
      if (st.fs) {
        return [`${t}if ${n} := ${expr(st.index, ctx)}; ${n} >= 1 && int(${n}) <= len(${tb}) {`,
          `${t}\t${ident(st.fs)} = &${tb}[${n}-1]`, `${t}\ts.Sy.Subrc = 0`, `${t}\ts.Sy.Tabix = ${n}`, `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
      }
      return [
        `${t}if ${n} := ${expr(st.index, ctx)}; ${n} >= 1 && int(${n}) <= len(${tb}) {`,
        `${t}\t${place(st.into, ctx)} = ${copied(`${tb}[${n}-1]`, st.into.type)}`,
        `${t}\ts.Sy.Subrc = 0`,
        `${t}\ts.Sy.Tabix = ${n}`,
        `${t}} else {`,
        `${t}\ts.Sy.Subrc = 4`,
        `${t}}`,
      ];
    }
    case "translate": {
      const p = place(st.target, ctx);
      return [`${t}${p} = abap.${st.upper ? "ToUpper" : "ToLower"}(${p})`];
    }
    case "call": {
      if (st.call.e === "nop_call") return [];
      const c = st.call;
      const run = c.receiving ? `${place(c.receiving, ctx)} = ${expr(c, ctx)}` : expr(c, ctx);
      // ultra/events: a c field passed to a generic TYPE c keeps its length
      const fits = c.args.filter((a) => a.fitc).map((a) => `${t}${place(a.place, ctx)} = abap.CFit(${place(a.place, ctx)}, ${a.fitc})`);
      if (fits.length) {
        if (!c.exceptions) return [`${t}${run}`, ...fits];
        const m = Object.entries(c.exceptions.map).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(", ");
        return [`${t}func() {`, `${t}\tdefer abap.Classic(s, ${JSON.stringify(c.callee)}, map[string]int32{${m}}, ${c.exceptions.others})`,
          `${t}\t${run}`, `${t}\ts.Sy.Subrc = 0`, `${t}}()`, ...fits];
      }
      if (!c.exceptions) return [`${t}${run}`];
      const m = Object.entries(c.exceptions.map).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(", ");
      return [`${t}func() {`, `${t}\tdefer abap.Classic(s, ${JSON.stringify(c.callee)}, map[string]int32{${m}}, ${c.exceptions.others})`,
        `${t}\t${run}`, `${t}\ts.Sy.Subrc = 0`, `${t}}()`];
    }
    // ultra/events: SET HANDLER, one registration per handler (the names
    // Ev* are mixed case, so no ABAP name, all upper or all lower, meets them)
    case "get_timestamp": return [`${t}${place(st.target, ctx)} = abap.TimeStamp(${st.dec})`];
    case "set_handler": {
      const lines = [`${t}func() {`];
      lines.push(`${t}\tEvFor := ${st.forObj ? `any(${expr(st.forObj, ctx)})` : "any(nil)"}`, `${t}\t_ = EvFor`);
      lines.push(`${t}\tEvOn := ${st.activation ? `abap.Activation(${expr(st.activation, ctx)})` : "true"}`);
      for (const h of st.handlers) {
        const ev = EVENTS.get(h.event);
        const filter = h.filter ? `func(o any) bool { _, ok := o.(${goType({k: "ref", name: h.filter})}); return ok }` : "nil";
        const obj = h.obj ? "any(EvH)" : h.me ? `any(${self(ctx, null)})` : "nil";
        lines.push(`${t}\t{`);
        if (h.obj) lines.push(`${t}\t\tEvH := abap.BoundHandler(${expr(h.obj, ctx)})`);
        lines.push(`${t}\t\tabap.SetHandler(s, ${JSON.stringify(h.event)}, EvFor, ${st.all}, ${ev.static}, ${obj}, ${JSON.stringify(h.key)}, ${filter}, func(s *abap.Session, EvSender any, EvArgs any) {`,
          `${t}\t\t\tEvA := EvArgs.(${evType(h.event)})`, `${t}\t\t\t_, _ = EvA, EvSender`,
          `${t}\t\t\t${expr(h.call, ctx)}`, `${t}\t\t}, EvOn)`, `${t}\t}`);
      }
      lines.push(`${t}}()`);
      return lines;
    }
    case "raise_event": {
      const ev = EVENTS.get(st.event);
      const fields = st.args.map((a) => `${ident(a.name)}: ${copied(expr(a.value, ctx), a.value.type, a.value)}`).join(", ");
      return [`${t}abap.RaiseEvent(s, ${JSON.stringify(st.event)}, ${st.sender ? `any(${expr(st.sender, ctx)})` : "nil"}, ${ev.static}, func() any { return ${evType(st.event)}{${fields}} })`];
    }
    case "raise_runtime": return [`${t}panic(abap.ArithmeticError{Class: ${JSON.stringify(st.cls)}, Op: ${JSON.stringify(st.op)}})`];
    case "call_fm": {
      // CALL FUNCTION of a module the host implements (frontend NATIVE_FM):
      // every actual as generic data, the module's classic exceptions by name
      const call = `${st.fn}(s, map[string]abap.Data{${st.args.map((x) => `${JSON.stringify(x.name)}: ${expr(x.value, ctx)}`).join(", ")}})`;
      if (!st.exceptions) return [`${t}${call}`];
      const m = Object.entries(st.exceptions.map).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(", ");
      return [`${t}func() {`, `${t}\tdefer abap.Classic(s, ${JSON.stringify(st.name)}, map[string]int32{${m}}, ${st.exceptions.others})`,
        `${t}\t${call}`, `${t}\ts.Sy.Subrc = 0`, `${t}}()`];
    }
    case "native": {
      const m = ctx.method;
      // a host function with arguments of its own (frontend NATIVE / KERNEL):
      // "&" places are pointers it writes; a kernel line inside a body (stmt)
      // returns nothing
      if (st.args) {
        const call = `${st.fn}(${["s", ...st.args.map((a) => (a.ref ? `&${place(a.value, ctx)}` : expr(a.value, ctx)))].join(", ")})`;
        return [`${t}${!st.stmt && m.returning ? "return " : ""}${call}`];
      }
      return [`${t}${m.returning ? "return " : ""}${st.fn}(${["s", ...(st.me ? ["me"] : []), ...m.params.map((p) => ident(p.name))].join(", ")})`];
    }
    // a JavaScript for (...) { of kernel code, as a range over what the host
    // function returns; each pair is written to the binds before the body
    case "kernel_loop":
      return [`${t}for _, kv := range ${st.fn}(${["s", ...st.args.map((a) => (a.ref ? `&${place(a.value, ctx)}` : expr(a.value, ctx)))].join(", ")}) {`,
        ...st.binds.map((b, i) => `${t}\t${place(b, ctx)} = kv[${i}]`),
        ...st.body.flatMap((x) => stmt(x, ctx, d + 1)), `${t}}`];
    case "raise":
      return [`${t}panic(abap.Raise(${expr(st.value, ctx)}, ${JSON.stringify(st.cls ?? "")}))`];
    case "raise_classic":
      return [`${t}panic(abap.ClassicException{Name: ${JSON.stringify(st.name)}, Method: ${JSON.stringify(st.method)}})`];
    case "if": {
      const lines = [];
      st.branches.forEach((b, i) => {
        lines.push(`${t}${i === 0 ? "if" : "} else if"} ${cond(b.cond, ctx)} {`);
        lines.push(...b.body.flatMap((x) => stmt(x, ctx, d + 1)));
      });
      if (st.else !== null) {
        lines.push(`${t}} else {`);
        lines.push(...st.else.flatMap((x) => stmt(x, ctx, d + 1)));
      }
      lines.push(`${t}}`);
      return lines;
    }
    case "case": {
      const lines = [`${t}{`, `${t}\t${st.temp} := ${expr(st.subject, ctx)}`, `${t}\t_ = ${st.temp}`];
      if (st.branches.length === 0 && st.else !== null) {
        lines.push(...st.else.flatMap((x) => stmt(x, ctx, d + 1)));
      } else {
        st.branches.forEach((b, i) => {
          lines.push(`${t}\t${i === 0 ? "if" : "} else if"} ${cond(b.cond, ctx)} {`);
          lines.push(...b.body.flatMap((x) => stmt(x, ctx, d + 2)));
        });
        if (st.else !== null) {
          lines.push(`${t}\t} else {`);
          lines.push(...st.else.flatMap((x) => stmt(x, ctx, d + 2)));
        }
        if (st.branches.length > 0) lines.push(`${t}\t}`);
      }
      lines.push(`${t}}`);
      return lines;
    }
    case "do": return withBuilders(st.body, ctx, t, () => {
      // sy-index is the pass counter of the innermost DO/WHILE and comes
      // back to the enclosing loop's value after ENDDO
      const n = ctx.loop++;
      const lines = [`${t}{`, `${t}\tsave${n} := s.Sy.Index`];
      if (st.times === null) lines.push(`${t}\tfor i${n} := int32(1); ; i${n}++ {`);
      else lines.push(`${t}\tn${n} := ${expr(st.times, ctx)}`, `${t}\tfor i${n} := int32(1); i${n} <= n${n}; i${n}++ {`);
      lines.push(`${t}\t\ts.Sy.Index = i${n}`, ...st.body.flatMap((x) => stmt(x, ctx, d + 2)), `${t}\t}`, `${t}\ts.Sy.Index = save${n}`, `${t}}`);
      return lines;
    });
    case "while": return withBuilders(st.body, ctx, t, () => {
      const n = ctx.loop++;
      return [
        `${t}{`, `${t}\tsave${n} := s.Sy.Index`,
        `${t}\tfor i${n} := int32(1); ${cond(st.cond, ctx)}; i${n}++ {`,
        `${t}\t\ts.Sy.Index = i${n}`,
        ...st.body.flatMap((x) => stmt(x, ctx, d + 2)),
        `${t}\t}`, `${t}\ts.Sy.Index = save${n}`, `${t}}`,
      ];
    }, [st.cond]);
    case "loop": return withBuilders(st.body, ctx, t, () => {
      // index-based on purpose: a row APPENDed inside the loop is visited,
      // as in ABAP; a range over the slice would not see it
      const n = ctx.loop++;
      const tb = expr(st.table, ctx);
      const start = st.from ? `int(${expr(st.from, ctx)}) - 1` : "0";
      const limit = st.to ? ` && i${n} < int(${expr(st.to, ctx)})` : "";
      const bind = st.fs ? `${ident(st.fs)} = &${tb}[i${n}]` : `${place(st.into, ctx)} = ${copied(`${tb}[i${n}]`, st.into.type)}`;
      const skip = st.where ? `${t}\t\tif !(${st.where.map((w) => `${tb}[i${n}].${ident(w.name)} ${w.op === "=" ? "==" : w.op === "<>" ? "!=" : w.op} ${expr(w.value, ctx)}`).join(" && ")}) { continue }` : null;
      return [
        `${t}{`, `${t}\tsave${n} := s.Sy.Tabix`, `${t}\ts.Sy.Subrc = 4`,
        `${t}\tfor i${n} := max(${start}, 0); i${n} < len(${tb})${limit}; i${n}++ {`,
        ...(skip ? [skip] : []),
        `${t}\t\ts.Sy.Tabix = int32(i${n} + 1)`, `${t}\t\ts.Sy.Subrc = 0`,
        `${t}\t\t${bind}`,
        ...st.body.flatMap((x) => stmt(x, ctx, d + 2)),
        `${t}\t}`, `${t}\ts.Sy.Tabix = save${n}`, `${t}}`,
      ];
    }, [st.where, st.from, st.to]);
    case "modify_index": {
      // sy-subrc 0 or 4; sy-tabix is left as it was (A4H 2026-09-24,
      // ZCL_GOGEN_T_MODFROM: "b:0/2" after MODIFY ... INDEX 3)
      const n = `idx${ctx.loop++}`;
      const tb = place(st.table, ctx);
      return [`${t}if ${n} := ${expr(st.index, ctx)}; ${n} >= 1 && int(${n}) <= len(${tb}) {`,
        `${t}\t${tb}[${n}-1] = ${copied(expr(st.value, ctx), st.value.type, st.value)}`, `${t}\ts.Sy.Subrc = 0`, `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    }
    case "split": return [`${t}${place(st.table, ctx)} = abap.Split(${expr(st.x, ctx)}, ${expr(st.sep, ctx)})`];
    case "split_into": return [`${t}{`, `${t}\tspl := abap.SplitInto(${expr(st.x, ctx)}, ${expr(st.sep, ctx)}, ${st.targets.length})`,
      `${t}\ts.Sy.Subrc = abap.SplitSubrc(spl, []int{${st.lens.join(", ")}})`,
      ...st.targets.map((x) => `${t}\t${place(x.target, ctx)} = ${expr(x.value, ctx)}`), `${t}}`];
    case "replace": {
      const p = place(st.target, ctx);
      return [`${t}${p}, s.Sy.Subrc = abap.ReplaceStmt(${p}, ${expr(st.pattern, ctx)}, ${expr(st.with, ctx)}, ${st.regex}, ${st.all}, ${st.icase}, ${st.off ? expr(st.off, ctx) : "0"}, ${st.len ? expr(st.len, ctx) : "abap.NoLength"}, ${st.cLen})`];
    }
    case "stub": return [`${t}panic(abap.NotCompiled(${JSON.stringify(st.where)}, ${JSON.stringify(st.reason)}))`];
    case "seq": return st.body.flatMap((x) => stmt(x, ctx, d));
    case "try": {
      // a panic of the runtime is an ABAP exception; a CATCH takes the
      // classes the front end found it covers, anything else goes on. The
      // TRY is a closure, so RETURN, EXIT and CONTINUE inside it come out as
      // a code (1, 2, 3) and are done again after it
      const n = ctx.loop++;
      const frame = {level: ctx.loopLevel ?? 0, mode: "body", used: new Set()};
      (ctx.tries ??= []).push(frame);
      const body = st.body.flatMap((x) => stmt(x, ctx, d + 1));
      frame.mode = "catch";
      const cases = st.catches.map((c) => [`${t}\t\t\tcase ${catchCond(c)}:`,
        ...catchInto(c, t),
        ...c.body.flatMap((x) => stmt(x, ctx, d + 4))]).flat();
      // a CLEANUP runs only when a TRY further out takes the exception (A4H:
      // the handler is looked for before unwinding; none, and the dump is at
      // the RAISE with no CLEANUP run), so each TRY with CATCHes registers
      // them in the session while its body runs
      const cleanup = st.cleanup ? [`${t}\t\t\t\tif abap.ClassBased(xR) && s.Handled(xR) {`, ...st.cleanup.flatMap((x) => stmt(x, ctx, d + 5)), `${t}\t\t\t\t}`] : [];
      ctx.tries.pop();
      const guard = st.catches.length ? `${t}\t\t\t\txE, xOK := abap.AsError(xR)\n${t}\t\t\t\txRX, xROK := abap.AsRaised(xR)\n${t}\t\t\t\t_, _, _, _ = xE, xOK, xRX, xROK\n${t}\t\t\t\treturn ${st.catches.map(catchCond).join(" || ")}` : null;
      const push = guard ? [`${t}\txH := len(s.Handlers)`, `${t}\ts.Handlers = append(s.Handlers, func(xR any) bool {`, guard, `${t}\t})`] : [];
      const pop = guard ? [`${t}\t\ts.Handlers = s.Handlers[:xH]`] : [];
      const out = [`${t}ctl${n} := func() (ctl int) {`, ...push, `${t}\tdefer func() {`, ...pop, `${t}\t\tif xR := recover(); xR != nil {`, `${t}\t\t\txE, xOK := abap.AsError(xR)`,
        `${t}\t\t\txRX, xROK := abap.AsRaised(xR)`, `${t}\t\t\t_, _, _, _ = xE, xOK, xRX, xROK`,
        `${t}\t\t\tswitch {`, ...cases, `${t}\t\t\tdefault:`, ...cleanup, `${t}\t\t\t\tabap.Repanic(xR, debug.Stack())`, `${t}\t\t\t}`, `${t}\t\t}`, `${t}\t}()`,
        ...body, `${t}\treturn 0`, `${t}}()`, `${t}_ = ctl${n}`];
      for (const code of [1, 2, 3]) if (frame.used.has(code)) out.push(`${t}if ctl${n} == ${code} {`, `${t}\t${leave(ctx, code)}`, `${t}}`);
      return out;
    }
    case "sort": {
      // SORT is not stable in ABAP; stable here, so equal keys keep their order
      // (ultra/itab: a key may be the line itself; p compares as a number)
      const tb = place(st.table, ctx);
      const cmp = st.keys.map((k) => {
        const [xv, yv] = k.line ? ["x", "y"] : [`x.${ident(k.name)}`, `y.${ident(k.name)}`];
        if (k.type.k === "p") return `if c := abap.CmpP(${xv}, ${yv}); c != 0 { return c ${k.desc ? ">" : "<"} 0 }`;
        return `if ${xv} != ${yv} { return ${xv} ${k.desc ? ">" : "<"} ${yv} }`;
      });
      return [`${t}sort.SliceStable(${tb}, func(a, b int) bool { x, y := ${tb}[a], ${tb}[b]; ${cmp.join("; ")}; return false })`];
    }
    // ultra/itab: APPEND LINES OF (frontend.mjs); lrow is the source row
    case "append_lines": {
      const tb = place(st.table, ctx);
      const n = ctx.loop++;
      const out = [`${t}{`, `${t}	src${n} := ${expr(st.src, ctx)}`, `${t}	lo${n}, hi${n} := 1, len(src${n})`];
      const bound = (v, name, set) => [`${t}	if b := int(${expr(v, ctx)}); b <= 0 {`,
        `${t}		panic(abap.ArithmeticError{Class: "TABLE_INVALID_INDEX", Op: "APPEND LINES OF ... ${name} " + abap.FmtI(int32(b))})`, `${t}	} else ${set}`];
      if (st.from) out.push(...bound(st.from, "FROM", `{
${t}		lo${n} = b
${t}	}`));
      if (st.to) out.push(...bound(st.to, "TO", `if b < hi${n} {
${t}		hi${n} = b
${t}	}`));
      const saved = ctx.lrow;
      ctx.lrow = `r${n}`;
      const v = st.value.e === "lrow" ? copied(`r${n}`, st.value.type) : expr(st.value, ctx);
      ctx.lrow = saved;
      out.push(`${t}	for i${n} := lo${n}; i${n} <= hi${n}; i${n}++ {`, `${t}		r${n} := src${n}[i${n}-1]`, `${t}		${tb} = append(${tb}, ${v})`, `${t}	}`,
        `${t}	s.Sy.Tabix = int32(len(${tb}))`, `${t}}`);
      return out;
    }
    // ultra/events: INSERT INTO TABLE of a SORTED table with a unique key
    case "insert_sorted": {
      const tb = place(st.table, ctx);
      const n = ctx.loop++;
      const get = (r, k) => (k.line ? r : `${r}.${ident(k.name)}`);
      const cmp = st.keys.map((k) => `if a, b := ${get(`r${n}`, k)}, ${get(`v${n}`, k)}; a != b { if a > b { c${n} = 1 } else { c${n} = -1 }; goto done${n} }`);
      return [`${t}{`, `${t}	v${n} := ${copied(expr(st.value, ctx), st.value.type, st.value)}`, `${t}	pos${n} := len(${tb})`, `${t}	s.Sy.Subrc = 0`,
        `${t}	for i${n}, r${n} := range ${tb} {`, `${t}		c${n} := 0`, ...cmp.map((x) => `${t}		${x}`), `${t}	done${n}:`,
        `${t}		if c${n} == 0 {`, `${t}			s.Sy.Subrc = 4`, `${t}			break`, `${t}		}`,
        `${t}		if c${n} > 0 {`, `${t}			pos${n} = i${n}`, `${t}			break`, `${t}		}`, `${t}	}`,
        `${t}	if s.Sy.Subrc == 0 {`, `${t}		${tb} = append(${tb}, v${n})`, `${t}		copy(${tb}[pos${n}+1:], ${tb}[pos${n}:])`, `${t}		${tb}[pos${n}] = v${n}`, `${t}	}`, `${t}}`];
    }
    case "insert_table": {
      const tb = place(st.table, ctx);
      const v = `ins${ctx.loop++}`;
      if (!st.unique) return [`${t}${tb} = append(${tb}, ${copied(expr(st.value, ctx), st.value.type, st.value)})`, `${t}s.Sy.Subrc = 0`];
      return [`${t}{`, `${t}\t${v} := ${copied(expr(st.value, ctx), st.value.type, st.value)}`, `${t}\ts.Sy.Subrc = 4`,
        ...(st.keys
          ? [`${t}\tdup${v} := false`, `${t}\tfor _, r := range ${tb} {`, `${t}\t\tif ${st.keys.map((k) => `r.${ident(k)} == ${v}.${ident(k)}`).join(" && ")} {`, `${t}\t\t\tdup${v} = true`, `${t}\t\t\tbreak`, `${t}\t\t}`, `${t}\t}`, `${t}\tif !dup${v} {`]
          : [`${t}\tif !abap.Contains(${tb}, ${v}) {`]),
        `${t}\t\t${tb} = append(${tb}, ${v})`, `${t}\t\ts.Sy.Subrc = 0`, `${t}\t}`, `${t}}`];
    }
    case "assert":
      return [`${t}if !(${cond(st.cond, ctx)}) {`, `${t}\tpanic(abap.ArithmeticError{Class: "ASSERTION_FAILED", Op: ${JSON.stringify(st.text)}})`, `${t}}`];
    case "assign_comp":
      return [`${t}if c, ok := abap.Component(${expr(st.from, ctx)}, ${expr(st.name, ctx)}); ok {`, `${t}\t${ident(st.fs.name)} = c`, `${t}\ts.Sy.Subrc = 0`,
        `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    case "assign_deref":
      return [`${t}if r := ${expr(st.ref, ctx)}; r.P != nil {`, `${t}\t${ident(st.fs.name)} = r`, `${t}\ts.Sy.Subrc = 0`, `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    case "assign_deref_typed":
      return [`${t}if r := ${expr(st.ref, ctx)}; r.P != nil {`, `${t}\t${ident(st.fs.name)} = abap.DerefAs[${goType(st.fs.type)}](r, ${JSON.stringify(st.text)})`,
        `${t}\ts.Sy.Subrc = 0`, `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    case "assign_data":
      return [`${t}${ident(st.fs.name)} = ${expr(st.value, ctx)}`];
    // a move into generic data writes into the slot it is bound to
    case "set_data":
      return [`${t}abap.MoveData(${expr(st.target, ctx)}, ${expr(st.value, ctx)})`];
    // ultra/events: APPEND INITIAL LINE TO <generic table> ASSIGNING <generic>
    case "append_initial_data": {
      const n = ctx.loop++;
      return [`${t}{`, `${t}\tr${n}, i${n} := abap.AppendInitialData(${expr(st.table, ctx)})`, `${t}\t${ident(st.fs)} = r${n}`, `${t}\ts.Sy.Tabix = int32(i${n})`, `${t}}`];
    }
    case "append_data":
      return [`${t}s.Sy.Tabix = int32(abap.AppendData(${expr(st.table, ctx)}, ${expr(st.value, ctx)}))`];
    case "clear_data":
      return [`${t}abap.ClearData(${expr(st.target, ctx)})`];
    case "get_ref":
      return [`${t}${place(st.target, ctx)} = ${expr(st.value, ctx)}`];
    // CREATE DATA ... TYPE <static type> (ultra/sadl): a new initial value
    case "create_data":
      return [`${t}${place(st.target, ctx)} = abap.Data{P: new(${goType(st.type)}), T: ${desc(st.type)}}`];
    // CREATE DATA ... TYPE [STANDARD TABLE OF] (name): the table registry
    case "create_data_dyn":
      return [`${t}${place(st.target, ctx)} = abap.CreateDataByName(${expr(st.name, ctx)}, ${st.table})`];
    case "describe_kind":
      return [`${t}${place(st.target, ctx)} = string(${expr(st.x, ctx)}.T.Kind)`];
    case "move_corr_data":
      return [`${t}abap.MoveCorrespondingData(${expr(st.to, ctx)}, ${expr(st.from, ctx)})`];
    case "shift_right_trailing": {
      const p = place(st.target, ctx);
      return [`${t}${p} = abap.ShiftRightTrailing(${p}, ${expr(st.mask, ctx)})`];
    }
    case "condense": {
      const p = place(st.target, ctx);
      return [`${t}${p} = abap.Condense(${p}, ${st.noGaps})`];
    }
    // DELETE / READ TABLE ... INDEX on a generic table (ultra/sadl, the SADL DPC's paging)
    case "delete_index_data":
      return [`${t}if abap.DeleteIndex(${expr(st.table, ctx)}, ${expr(st.index, ctx)}) {`, `${t}\ts.Sy.Subrc = 0`, `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    case "read_index_data": {
      const n = `idx${ctx.loop++}`;
      return [`${t}if ${n}, tb${n} := ${expr(st.index, ctx)}, ${expr(st.table, ctx)}; ${n} >= 1 && int(${n}) <= abap.Lines(tb${n}) {`,
        `${t}\t${ident(st.fs)} = abap.Row(tb${n}, int(${n}-1))`, `${t}\ts.Sy.Subrc = 0`, `${t}\ts.Sy.Tabix = ${n}`, `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    }
    case "loop_data": return withBuilders(st.body, ctx, t, () => {
      const n = ctx.loop++;
      const tb = `tab${n}`;
      return [`${t}{`, `${t}\t${tb} := ${expr(st.table, ctx)}`, `${t}\tsave${n} := s.Sy.Tabix`, `${t}\ts.Sy.Subrc = 4`,
        `${t}\tfor i${n} := 0; i${n} < abap.Lines(${tb}); i${n}++ {`,
        `${t}\t\ts.Sy.Tabix = int32(i${n} + 1)`, `${t}\t\ts.Sy.Subrc = 0`, `${t}\t\t${ident(st.fs)} = abap.Row(${tb}, i${n})`,
        ...st.body.flatMap((x) => stmt(x, ctx, d + 2)), `${t}\t}`, `${t}\ts.Sy.Tabix = save${n}`, `${t}}`];
    });
    case "call_dyn_static":
      return [`${t}abap.CallStatic(s, ${expr(st.cls, ctx)}, ${JSON.stringify(st.method)}, map[string]abap.Data{${st.args.map((a) => `${JSON.stringify(a.name)}: ${expr(a.value, ctx)}`).join(", ")}})`];
    case "select_table": {
      // INTO TABLE replaces the table; each row is scanned column by column
      // and moved into the target's fields (by name with CORRESPONDING)
      const n = ctx.loop++;
      const tgt = place(st.target, ctx);
      const rowGo = goType(st.target.type.row);
      const vars = st.cols.map((c, i) => `c${i}_${n} ${c.type.k === "i" ? "abap.DBInt" : "abap.DBString"}`);
      const moves = st.assign.map((a, i) => (a === null ? null
        : `${a.line ? "r" : `r.${ident(a.field)}`} = ${st.cols[i].type.k === "i" ? `abap.DBI(c${i}_${n})` : st.cols[i].type.k === "string" ? `abap.DBStr(c${i}_${n})` : st.cols[i].type.k === "xstring" ? `abap.DBXStr(c${i}_${n})` : st.cols[i].type.k === "p" ? dbP(`c${i}_${n}`, a.type) : `abap.DBChar(c${i}_${n})`}`)).filter(Boolean);
      return [`${t}${tgt} = nil`,
        `${t}if n${n} := abap.Select(s, ${JSON.stringify(st.sql)}, ${sqlArgs(st.args, ctx)}, ${hostPreds(st.preds, ctx)}, func(scan func(dest ...any) error) {`,
        `${t}\tvar ${vars.join("\n" + t + "\tvar ")}`,
        `${t}\tabap.Must(scan(${st.cols.map((_, i) => `&c${i}_${n}`).join(", ")}))`,
        `${t}\tvar r ${rowGo}`, ...moves.map((m) => `${t}\t${m}`), `${t}\t${tgt} = append(${tgt}, r)`,
        `${t}}); n${n} > 0 {`, `${t}\ts.Sy.Subrc, s.Sy.Dbcnt = 0, int32(n${n})`, `${t}} else {`, `${t}\ts.Sy.Subrc, s.Sy.Dbcnt = 4, 0`, `${t}}`];
    }
    case "unassign":
      return [`${t}${ident(st.fs.name)} = ${st.fs.type.k === "data" ? "abap.Data{}" : "nil"}`];
    case "select_dyn": {
      // dynamic Open SQL (go/abap selectdyn.go): the parts given at run time
      // as strings, the target as generic data
      const strs = (v) => (v === null ? "nil" : v.e === "strlist" ? `[]string{${v.values.map((x) => JSON.stringify(x)).join(", ")}}`
        : v.type.k === "table" ? expr(v, ctx) : `[]string{${expr(v, ctx)}}`);
      return [`${t}abap.SelectDyn(s, abap.DynSelect{Table: ${expr(st.table, ctx)}, Fields: ${strs(st.fields)}, Star: ${st.fields === null}, ` +
        `Where: ${st.where === null ? `""` : expr(st.where, ctx)}, HasWhere: ${st.where !== null}, GroupBy: ${strs(st.groupBy)}, OrderBy: ${strs(st.orderBy)}, ` +
        `PrimaryKey: ${st.primaryKey}, Corresponding: ${st.corresponding}, Stmt: ${JSON.stringify(st.text)}}, ${expr(st.target, ctx)})`];
    }
    case "select_single": {
      // one row at most; only the fields the columns go to are written, and
      // nothing when there is no row
      const n = ctx.loop++;
      const tgt = place(st.target, ctx);
      const vars = st.cols.map((c, i) => `c${i}_${n} ${c.type.k === "i" ? "abap.DBInt" : "abap.DBString"}`);
      // a character field takes the column cut to its length
      const fit = (v, ft) => (ft.k === "c" ? `abap.CFit(${v}, ${ft.len ?? 1})` : ft.k === "d" ? `abap.CFit(${v}, 8)` : ft.k === "t" ? `abap.CFit(${v}, 6)` : v);
      const moves = st.assign.map((a, i) => (a === null ? null
        : `${a.line ? tgt : `${tgt}.${ident(a.field)}`} = ${fit(st.cols[i].type.k === "i" ? `abap.DBI(c${i}_${n})` : st.cols[i].type.k === "string" ? `abap.DBStr(c${i}_${n})` : st.cols[i].type.k === "xstring" ? `abap.DBXStr(c${i}_${n})` : st.cols[i].type.k === "p" ? dbP(`c${i}_${n}`, a.type) : `abap.DBChar(c${i}_${n})`, a.type)}`)).filter(Boolean);
      return [`${t}if abap.Select(s, ${JSON.stringify(st.sql)}, ${sqlArgs(st.args, ctx)}, ${hostPreds(st.preds, ctx)}, func(scan func(dest ...any) error) {`,
        `${t}\tvar ${vars.join("\n" + t + "\tvar ")}`,
        `${t}\tabap.Must(scan(${st.cols.map((_, i) => `&c${i}_${n}`).join(", ")}))`,
        ...moves.map((m) => `${t}\t${m}`),
        `${t}}) > 0 {`, `${t}\ts.Sy.Subrc, s.Sy.Dbcnt = 0, 1`, `${t}} else {`, `${t}\ts.Sy.Subrc, s.Sy.Dbcnt = 4, 0`, `${t}}`];
    }
    case "select_loop": return withBuilders(st.body, ctx, t, () => {
      // SELECT ... ENDSELECT (frontend selectLoop, A4H 2026-09-24): the rows
      // are read first, then each pass starts with sy-subrc 0 and sy-dbcnt
      // the rows so far; after the loop, EXIT included, 0 and the rows read,
      // or 4 and 0 when there was no row and the work area is untouched
      const n = ctx.loop++;
      const tgt = place(st.target, ctx);
      const fit = (v, ft) => (ft.k === "c" ? `abap.CFit(${v}, ${ft.len ?? 1})` : ft.k === "d" ? `abap.CFit(${v}, 8)` : ft.k === "t" ? `abap.CFit(${v}, 6)` : v);
      const val = (i) => (st.cols[i].type.k === "i" ? `abap.DBI(q${n}.c${i})` : st.cols[i].type.k === "string" ? `abap.DBStr(q${n}.c${i})` : st.cols[i].type.k === "xstring" ? `abap.DBXStr(q${n}.c${i})` : st.cols[i].type.k === "p" ? dbP(`q${n}.c${i}`, st.assign[i]?.type ?? st.cols[i].type) : `abap.DBChar(q${n}.c${i})`);
      const moves = st.assign.map((a, i) => (a === null ? null : `${a.line ? tgt : `${tgt}.${ident(a.field)}`} = ${fit(val(i), a.type)}`)).filter(Boolean);
      return [`${t}{`,
        `${t}\ttype selrow${n} struct {`, ...st.cols.map((c, i) => `${t}\t\tc${i} ${c.type.k === "i" ? "abap.DBInt" : "abap.DBString"}`), `${t}\t}`,
        `${t}\tvar rows${n} []selrow${n}`,
        `${t}\tabap.Select(s, ${JSON.stringify(st.sql)}, ${sqlArgs(st.args, ctx)}, ${hostPreds(st.preds, ctx)}, func(scan func(dest ...any) error) {`,
        `${t}\t\tvar r selrow${n}`, `${t}\t\tabap.Must(scan(${st.cols.map((_, i) => `&r.c${i}`).join(", ")}))`, `${t}\t\trows${n} = append(rows${n}, r)`, `${t}\t})`,
        `${t}\tread${n} := int32(0)`,
        `${t}\tfor _, q${n} := range rows${n} {`,
        `${t}\t\t_ = q${n}`, `${t}\t\tread${n}++`, `${t}\t\ts.Sy.Subrc, s.Sy.Dbcnt = 0, read${n}`,
        ...moves.map((m) => `${t}\t\t${m}`),
        ...st.body.flatMap((x) => stmt(x, ctx, d + 2)),
        `${t}\t}`,
        `${t}\tif read${n} > 0 {`, `${t}\t\ts.Sy.Subrc, s.Sy.Dbcnt = 0, read${n}`, `${t}\t} else {`, `${t}\t\ts.Sy.Subrc, s.Sy.Dbcnt = 4, 0`, `${t}\t}`,
        `${t}}`];
    });
    case "select_count": {
      // the count into the target and into sy-dbcnt (A4H), sy-subrc 4 when 0
      const n = ctx.loop++;
      return [`${t}{`, `${t}\tvar cnt${n} abap.DBInt`,
        `${t}\tabap.Select(s, ${JSON.stringify(st.sql)}, ${sqlArgs(st.args, ctx)}, ${hostPreds(st.preds, ctx)}, func(scan func(dest ...any) error) { abap.Must(scan(&cnt${n})) })`,
        `${t}\t${place(st.target, ctx)} = abap.DBI(cnt${n})`, `${t}\ts.Sy.Dbcnt = abap.DBI(cnt${n})`,
        `${t}\tif cnt${n}.Int64 > 0 {`, `${t}\t\ts.Sy.Subrc = 0`, `${t}\t} else {`, `${t}\t\ts.Sy.Subrc = 4`, `${t}\t}`, `${t}}`];
    }
    case "db_write_sql":
      return [`${t}abap.ExecWrite(s, ${JSON.stringify(st.sql)}, ${sqlArgs(st.args, ctx)}, ${hostPreds(st.preds, ctx)})`];
    case "db_write": {
      // the rows as the Go values of the work area's fields, MANDT the logon
      // client; the runtime binds and renders them (go/abap/dbwrite.go)
      const n = ctx.loop++;
      const spec = `abap.WriteSpec{Table: ${JSON.stringify(st.table)}, Cols: []abap.WriteCol{${st.cols.map((c) => `{Name: ${JSON.stringify(c.name)}, Type: ${irTypeGo(c.ir)}}`).join(", ")}}, Key: ${goStrings(st.key)}}`;
      const fields = STRUCTDEFS.get((st.fromTable ? st.value.type.row : st.value.type).go)?.fields ?? [];
      const value = (c, i) => {
        if (c.client) return "abap.Mandt";
        const f = `r${n}.${ident(fields[i].name)}`;
        return c.kind === "c" ? `abap.DBC(${f})` : c.kind === "i" ? `int64(${f})` : f;
      };
      const row = `[]any{${st.cols.map(value).join(", ")}}`;
      const rows = st.fromTable
        ? `func() [][]any { rows := [][]any{}; for _, r${n} := range ${expr(st.value, ctx)} { rows = append(rows, ${row}) }; return rows }()`
        : `func() [][]any { r${n} := ${expr(st.value, ctx)}; return [][]any{${row}} }()`;
      const call = {insert: "InsertRows", update: "UpdateRows", delete: "DeleteRows", modify: "ModifyRows"}[st.op];
      return [`${t}abap.${call}(s, ${spec}, ${rows}${st.op === "insert" ? `, ${JSON.stringify(st.onDuplicate)}` : ""})`];
    }
    case "create_dyn":
      return [`${t}${place(st.target, ctx)} = abap.CreateAs[${goType(st.target.type)}](s, ${expr(st.name, ctx)})`];
    case "read_key": {
      const tb = expr(st.table, ctx);
      const n = ctx.loop++;
      const cond = st.keys.map((k) => (k.line ? `r${n} == ${expr(k.value, ctx)}` : `r${n}.${ident(k.name)} == ${expr(k.value, ctx)}`)).join(" && ");
      if (st.into?.conv) throw new Error("READ TABLE INTO a work area of another type");
      const bind = st.fs ? `${ident(st.fs)} = &${tb}[i${n}]` : st.into ? `${place(st.into, ctx)} = ${copied(`r${n}`, st.into.type)}` : null;
      // ultra/events (fix round): a SORTED table, see read_key in frontend.mjs
      if (st.sorted) {
        const kv = (j) => `k${n}_${j}`;
        const get = (k) => (k.line ? `r${n}` : `r${n}.${ident(k.name)}`);
        const all = st.keys.map((k, j) => `${get(k)} == ${kv(j)}`).join(" && ");
        const decl = st.keys.flatMap((k, j) => [`${t}\t${kv(j)} := ${expr(k.value, ctx)}`, `${t}\t_ = ${kv(j)}`]);
        const found = [...(bind ? [`${t}\t\t\t${bind}`] : []), `${t}\t\t\ts.Sy.Subrc = 0`, `${t}\t\t\ts.Sy.Tabix = int32(i${n} + 1)`, `${t}\t\t\thit${n} = true`, `${t}\t\t\tbreak`];
        if (st.sorted.prefix.length === 0) {
          return [`${t}{`, ...decl, `${t}\thit${n} := false`, `${t}\tfor i${n}, r${n} := range ${tb} {`, `${t}\t\tif ${all} {`, ...found, `${t}\t\t}`, `${t}\t}`,
            `${t}\tif !hit${n} {`, `${t}\t\ts.Sy.Subrc = 4`, `${t}\t\ts.Sy.Tabix = 0`, `${t}\t}`, `${t}}`];
        }
        // c: the row's key part against the key given, -1 / 0 / 1; pos: the
        // first row whose key part is not less than the key given
        const cmp = st.sorted.prefix.map((j) => `if a, b := ${get(st.keys[j])}, ${kv(j)}; a != b { if a > b { c${n} = 1 } else { c${n} = -1 }; goto cmp${n} }`);
        return [`${t}{`, ...decl, `${t}\tpos${n} := -1`, `${t}\thit${n} := false`,
          `${t}\tfor i${n}, r${n} := range ${tb} {`, `${t}\t\tc${n} := 0`, ...cmp.map((x) => `${t}\t\t${x}`), `${t}\tcmp${n}:`,
          `${t}\t\tif c${n} < 0 {`, `${t}\t\t\tcontinue`, `${t}\t\t}`,
          `${t}\t\tif pos${n} < 0 {`, `${t}\t\t\tpos${n} = i${n}`, `${t}\t\t}`,
          `${t}\t\tif c${n} > 0 {`, `${t}\t\t\tbreak`, `${t}\t\t}`,
          `${t}\t\tif ${all} {`, ...found, `${t}\t\t}`, `${t}\t}`,
          `${t}\tif !hit${n} {`,
          ...(st.sorted.extra ? [`${t}\t\t${LINES && st.pos ? `/*line ${st.pos.file}:${st.pos.row}*/ ` : ""}panic(abap.NotCompiled("READ TABLE", "a miss on a SORTED table with a key part and components outside the key: not measured"))`] : []),
          `${t}\t\ts.Sy.Subrc = 4`, `${t}\t\tif pos${n} < 0 {`, `${t}\t\t\tpos${n} = len(${tb})`, `${t}\t\t\ts.Sy.Subrc = 8`, `${t}\t\t}`, `${t}\t\ts.Sy.Tabix = int32(pos${n} + 1)`, `${t}\t}`, `${t}}`];
      }
      return [`${t}{`, `${t}\ts.Sy.Subrc = 4`, `${t}\tfor i${n}, r${n} := range ${tb} {`, `${t}\t\t_, _ = i${n}, r${n}`, `${t}\t\tif ${cond} {`,
        ...(bind ? [`${t}\t\t\t${bind}`] : []), `${t}\t\t\ts.Sy.Subrc = 0`, `${t}\t\t\ts.Sy.Tabix = ${st.hashed ? "0" : `int32(i${n} + 1)`}`,
        `${t}\t\t\tbreak`, `${t}\t\t}`, `${t}\t}`, `${t}}`];
    }
    case "find": {
      // IN TABLE and IN SECTION (ultra/sadl): see abap.FindTable / abap.FindSection
      const call = st.table ? `fok, fline, foff, flen, fsub := abap.FindTable(${expr(st.table, ctx)}, ${expr(st.pattern, ctx)}, ${st.regex}, ${st.icase}, ${st.subs.length})`
        : "secOff" in st ? `fok, foff, flen, fsub := abap.FindSection(${expr(st.subject, ctx)}, ${expr(st.pattern, ctx)}, ${st.icase}, ${st.secOff ? expr(st.secOff, ctx) : "0"}, ${st.secLen ? expr(st.secLen, ctx) : "-1"}, ${st.subs.length})`
          : `fok, foff, flen, fsub := abap.FindStmt(${expr(st.subject, ctx)}, ${expr(st.pattern, ctx)}, ${st.regex}, ${st.icase}, ${st.subs.length})`;
      const lines = [`${t}{`, `${t}\t${call}`,
        `${t}\t_, _, _ = foff, flen, fsub`, ...(st.table ? [`${t}\t_ = fline`] : []), `${t}\tif fok {`, `${t}\t\ts.Sy.Subrc = 0`];
      if (st.line) lines.push(`${t}\t\t${place(st.line, ctx)} = fline`);
      if (st.off) lines.push(`${t}\t\t${place(st.off, ctx)} = foff`);
      if (st.len) lines.push(`${t}\t\t${place(st.len, ctx)} = flen`);
      for (const x of st.subs) lines.push(`${t}\t\t${place(x.target, ctx)} = ${expr(x.value, ctx)}`);
      lines.push(`${t}\t} else {`, `${t}\t\ts.Sy.Subrc = 4`, `${t}\t}`, `${t}}`);
      return lines;
    }
    case "delete_where": {
      // sy-subrc 0 when a row went, 4 when none did
      const tb = place(st.table, ctx);
      const n = ctx.loop++;
      const keep = st.where.map((w) => `r${n}.${ident(w.name)} ${w.op === "=" ? "==" : w.op === "<>" ? "!=" : w.op} ${expr(w.value, ctx)}`).join(" && ");
      return [`${t}{`, `${t}\tkept${n} := ${tb}[:0]`, `${t}\tfor _, r${n} := range ${tb} {`, `${t}\t\tif !(${keep}) {`,
        `${t}\t\t\tkept${n} = append(kept${n}, r${n})`, `${t}\t\t}`, `${t}\t}`,
        `${t}\ts.Sy.Subrc = 4`, `${t}\tif len(kept${n}) < len(${tb}) {`, `${t}\t\ts.Sy.Subrc = 0`, `${t}\t}`, `${t}\t${tb} = kept${n}`, `${t}}`];
    }
    case "delete_index": {
      const n = `idx${ctx.loop++}`;
      const tb = place(st.table, ctx);
      return [`${t}if ${n} := ${expr(st.index, ctx)}; ${n} >= 1 && int(${n}) <= len(${tb}) {`,
        `${t}\t${tb} = append(${tb}[:${n}-1], ${tb}[${n}:]...)`, `${t}\ts.Sy.Subrc = 0`, `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    }
    case "insert_index": {
      const n = `idx${ctx.loop++}`;
      const tb = place(st.table, ctx);
      return [`${t}if ${n} := ${expr(st.index, ctx)}; ${n} >= 1 && int(${n}) <= len(${tb})+1 {`,
        `${t}\t${tb} = abap.InsertAt(${tb}, ${n}, ${copied(expr(st.value, ctx), st.value.type, st.value)})`, `${t}\ts.Sy.Subrc = 0`, `${t}\ts.Sy.Tabix = ${n}`,
        `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    }
    case "nop": return [];
    case "commit_work": return [`${t}abap.CommitWork(s)`];
    case "rollback_work": return [`${t}abap.RollbackWork(s)`];
    case "exit": return [`${t}${leave(ctx, 2)}`];
    case "continue": return [`${t}${leave(ctx, 3)}`];
    case "return": return [`${t}${leave(ctx, 1)}`];
    default: throw new Error(`no Go for statement ${st.s}`);
  }
}

// a DEC column read into a p field, rounded to the field's decimals
const dbP = (v, ft) => `abap.DBP(${v}, ${ft.len ?? 8}, ${ft.dec ?? 0})`;

const I_OPS = {"+": "abap.AddI", "-": "abap.SubI", "*": "abap.MulI", "/": "abap.DivI", DIV: "abap.DivIntI", MOD: "abap.ModI"};
const I8_OPS = {"+": "abap.AddI8", "-": "abap.SubI8", "*": "abap.MulI8", "/": "abap.DivI8", DIV: "abap.DivIntI8", MOD: "abap.ModI8"};
const P_OPS = {"+": "abap.AddP", "-": "abap.SubP", "*": "abap.MulP", "/": "abap.DivP", DIV: "abap.DivIntP", MOD: "abap.ModP"};
const F_OPS = {"/": "abap.DivF", DIV: "abap.DivIntF", MOD: "abap.ModF"};
const FN_F = {SIN: "abap.Sin", COS: "abap.Cos", TAN: "math.Tan", SQRT: "abap.SqrtF", EXP: "math.Exp", LOG: "abap.LogF", LOG10: "math.Log10"};

function expr(e, ctx) {
  switch (e.e) {
    case "var": case "attr": case "static": case "field": case "fs": case "row": case "refattr": return place(e, ctx);
    case "zero": return zero(e.type) === "nil" ? `(${goType(e.type)})(nil)` : zero(e.type);
    case "case_fn": return `abap.${e.upper ? "ToUpper" : "ToLower"}(${expr(e.x, ctx)})`;
    case "table_lit": return `${goType(e.type)}{${e.rows.map((r) => copied(expr(r, ctx), r.type, r)).join(", ")}}`;
    case "bool": return `func() string { if ${cond(e.cond, ctx)} { return "X" }; return ${JSON.stringify(e.blank)} }()`;
    case "cond": {
      const parts = e.branches.map((b) => `if ${cond(b.cond, ctx)} { return ${expr(b.value, ctx)} }`);
      return `func() ${goType(e.type)} { ${parts.join("; ")}; return ${e.else ? expr(e.else, ctx) : zero(e.type)} }()`;
    }
    case "const": return e.go;
    case "temp": return e.name;
    case "padc": return `abap.PadC(${expr(e.x, ctx)}, ${e.n})`;
    case "flag": return String(e.value);
    case "str_fn": return `abap.${e.fn}(${e.args.map((a) => expr(a, ctx)).join(", ")})`;
    case "sy": return `s.Sy.${e.field}`;
    case "sy_mandt": return "abap.Mandt";
    case "sy_host": return `abap.${e.name}`;
    case "int": return `int32(${e.value})`;
    case "float": return Number.isInteger(e.value) ? `float64(${e.value})` : String(e.value);
    case "chars": case "str": return JSON.stringify(e.value);
    case "template": {
      const parts = e.parts.map((p) => (p.text !== undefined ? JSON.stringify(p.text) : templatePart(p.value, ctx, p.opts ?? {})));
      return parts.length === 0 ? `""` : `(${parts.join(" + ")})`;
    }
    case "concat": return `(${expr(e.l, ctx)} + ${expr(e.r, ctx)})`;
    case "struct":
      return `${e.type.go}{${e.fields.map((f) => `${ident(f.name)}: ${copied(expr(f.value, ctx), f.value.type, f.value)}`).join(", ")}}`;
    case "neg": return e.type.k === "i" ? `abap.NegI(${expr(e.x, ctx)})` : e.type.k === "p" ? `abap.NegP(${expr(e.x, ctx)})` : `(-${expr(e.x, ctx)})`;
    case "bin":
      if (e.type.k === "x") return `abap.BitX(${JSON.stringify(e.op)}, ${expr(e.l, ctx)}, ${expr(e.r, ctx)})`;
      if (e.type.k === "i") return `${I_OPS[e.op]}(${expr(e.l, ctx)}, ${expr(e.r, ctx)})`;
      if (e.type.k === "p") return `${P_OPS[e.op]}(${expr(e.l, ctx)}, ${expr(e.r, ctx)})`;
      if (e.type.k === "int8") return `${I8_OPS[e.op]}(${expr(e.l, ctx)}, ${expr(e.r, ctx)})`;
      if (F_OPS[e.op] !== undefined) return `${F_OPS[e.op]}(${expr(e.l, ctx)}, ${expr(e.r, ctx)})`;
      if (e.op === "**") return `abap.PowF(${expr(e.l, ctx)}, ${expr(e.r, ctx)})`;
      return `(${expr(e.l, ctx)} ${e.op} ${expr(e.r, ctx)})`;
    case "conv": return conv(e, ctx);
    case "fn": return fn(e, ctx);
    case "lines": return `int32(len(${expr(e.table, ctx)}))`;
    case "strlen": return `abap.Strlen(${expr(e.x, ctx)})`;
    case "uccp": return `abap.Uccp(${expr(e.x, ctx)})`;
    case "exc_text": return `${expr(e.x, ctx)}.TextOf(s)`;
    case "random": return `abap.RandomInt(${expr(e.min, ctx)}, ${expr(e.max, ctx)})`;
    case "find": return `abap.Find(${expr(e.val, ctx)}, ${expr(e.sub, ctx)}, ${e.off ? expr(e.off, ctx) : "0"})`;
    case "xstrlen": return `int32(len(${expr(e.x, ctx)}))`;
    case "uccpi": return `abap.Uccpi(${expr(e.x, ctx)})`;
    case "substr": {
      const off = e.off ? expr(e.off, ctx) : "0";
      const len = e.len ? expr(e.len, ctx) : "-1";
      if (e.base.k === "x" || e.base.k === "xstring") return `abap.SubX(${expr(e.x, ctx)}, ${off}, ${len})`;
      if (e.base.k === "c") return `abap.SubC(${expr(e.x, ctx)}, ${e.base.len}, ${off}, ${len})`;
      return `abap.SubS(${expr(e.x, ctx)}, ${off}, ${len})`;
    }
    case "new": return `New_${typeName(e.cls)}(${["s", ...e.args.map((a) => importingArg(a, ctx))].join(", ")})`;
    case "call": {
      const args = ["s", ...e.args.map((a) => (a.dir === "importing" ? importingArg(a, ctx)
        : a.wrap ? `&${expr(a.wrap, ctx)}` : a.place === null ? `new(${goType(a.type)})` : `&${place(a.place, ctx)}`))];
      if (e.receiver) return `${expr(e.receiver, ctx)}.${typeName(e.method)}(${args.join(", ")})`;
      if (e.owner) return `${funcName(e.owner, e.method)}(${args.join(", ")})`;
      if (e.static) return `${funcName(ctx.cls.name, e.method)}(${args.join(", ")})`;
      // SUPER->m( ): the superclass's part, bound statically
      if (e.sup) return `me.${typeName(e.sup)}.${typeName(e.method)}(${args.join(", ")})`;
      return `${self(ctx, e.method)}.${typeName(e.method)}(${args.join(", ")})`;
    }
    case "nop_call": return "";
    case "xbytes": return constLiteral({type: e.type, value: e.value});
    case "type_length": return `abap.DescrLength(${expr(e.x, ctx)})`;
    case "type_kind": return `string(${expr(e.x, ctx)}.T.Kind)`;
    // ultra/events: inside a handler's registration (set_handler)
    case "ev_arg": return `EvA.${ident(e.name)}`;
    case "ev_sender": return `abap.SenderAs[${goType(e.type)}](EvSender)`;
    case "ev_handler": return "EvH";
    case "me": return self(ctx, null);
    case "upcast": {
      // a nil pointer put into an interface is not a nil interface: an unbound
      // reference must stay initial when it is widened
      const x = expr(e.x, ctx);
      const fromPtr = e.x.type.k === "ref" && !e.x.type.intf && !POLY.has(e.x.type.name);
      const toIface = e.type.intf || POLY.has(e.type.name);
      return fromPtr && toIface && e.x.e !== "me" && e.x.e !== "new" ? `abap.Up[${goType(e.type)}](${x})` : x;
    }
    case "cast": return `abap.Cast[${goType(e.type)}](${expr(e.x, ctx)})`;
    // a typed slot seen as generic data: its address and its descriptor
    case "lrow": return ctx.lrow;
    case "wrap": return `abap.Data{P: ${PLACES.has(e.x.e) ? `&${place(e.x, ctx)}` : `abap.Ptr(${expr(e.x, ctx)})`}, T: ${desc(e.x.type)}}`;
    case "unwrap": return unwrapTo(e.type, expr(e.x, ctx));
    case "lines_data": return `int32(abap.Lines(${expr(e.x, ctx)}))`;
    default: throw new Error(`no Go for expression ${e.e}`);
  }
}

/** a generic value read into a typed one: an i, or a string fitted to a c's length */
function unwrapTo(t, d) {
  if (t.k === "i") return `abap.DataI(${d})`;
  if (t.k === "c") return `abap.CFit(abap.DataString(${d}), ${t.len})`;
  if (t.k === "p") return `abap.PFit(abap.DataP(${d}), ${t.len}, ${t.dec ?? 0}, false)`;
  return `abap.DataString(${d})`;
}

function templatePart(v, ctx, opts) {
  let out = templateValue(v, ctx, opts);
  if (opts.width !== undefined) out = `abap.Pad(${out}, ${opts.width}, ${JSON.stringify(opts.align ?? "LEFT")}, ${JSON.stringify(opts.pad ?? " ")})`;
  return out;
}

function templateValue(v, ctx, opts) {
  const x = expr(v, ctx);
  if (opts.decimals !== undefined) return v.type.k === "p" ? `abap.FmtPDec(${x}, ${opts.decimals})` : `abap.FmtFDec(${x}, ${opts.decimals})`;
  switch (v.type.k) {
    case "i": return `abap.FmtI(${x})`;
    case "int8": return `abap.FmtI8(${x})`;
    case "f": return `abap.FmtF(${x})`;
    case "p": return `abap.FmtP(${x}, ${opts.pdec ?? v.type.dec ?? 0})`;
    case "string": case "c": case "d": case "t": case "n": return x;
    case "x": case "xstring": return `abap.XToHex(${x})`;
    case "data": return `abap.FmtData(${x})`;
    default: throw new Error(`template part ${v.type.k}`);
  }
}

function conv(e, ctx) {
  const x = expr(e.x, ctx);
  const from = e.from.k;
  const to = e.to.k;
  switch (e.kind) {
    case "struct_layout":
      return `func(v ${goType(e.from)}) ${goType(e.to)} { return ${goType(e.to)}{${e.pairs.map(([t, f]) => `${ident(t)}: v.${ident(f)}`).join(", ")}} }(${x})`;
    case "num":
      if (from === "i" && to === "f") return `float64(${x})`;
      if (from === "f" && to === "i") return `abap.F2I(${x})`;
      if (from === "i" && to === "int8") return `int64(${x})`;
      if (from === "int8" && to === "i") return `abap.I8ToI(${x})`;
      if (from === "int8" && to === "f") return `float64(${x})`;
      if (from === "f" && to === "int8") return `abap.F2I8(${x})`;
      break;
    case "c2s": return x;
    case "table_rows": return `func() ${goType(e.to)} { var out ${goType(e.to)}; for _, ConvRow := range ${x} { out = append(out, ${expr(e.row, ctx)}) }; return out }()`;
    case "s2c": return `abap.CFit(${x}, ${e.to.len})`;
    case "i2s": return `abap.IToString(${x})`;
    case "x2s": return e.to.k === "c" ? `abap.CFit(abap.XToHex(${x}), ${e.to.len})` : `abap.XToHex(${x})`;
    case "i2x": return `abap.IToX(${x}, ${e.to.len})`;
    // packed numbers, go/abap packed.go
    case "i2pc": return `abap.IToP(${x})`;
    case "c2pc": return `abap.CToP(${x})`;
    case "i2p": return `abap.PFit(abap.IToP(${x}), ${e.to.len}, ${e.to.dec ?? 0}, false)`;
    case "p2p": return `abap.PFit(${x}, ${e.to.len}, ${e.to.dec ?? 0}, ${!!e.arith})`;
    case "f2p": return `abap.PFit(abap.FToP(${x}), ${e.to.len}, ${e.to.dec ?? 0}, false)`;
    case "c2p": return `abap.PFit(abap.CToP(${x}), ${e.to.len}, ${e.to.dec ?? 0}, false)`;
    case "p2i": return `abap.PToI(${x}, ${!!e.arith})`;
    case "p2i8": return `abap.PToI8(${x}, ${!!e.arith})`;
    case "p2f": return `abap.PToF(${x})`;
    case "p2s": return `abap.PToString(${x}, ${e.from.dec ?? 0})`;
    case "p2c": return `abap.PToC(${x}, ${e.from.dec ?? 0}, ${e.to.len})`;
    case "p2n": return `abap.PToN(${x}, ${e.to.len})`;
    case "x2i": return `abap.XToI(${x})`;
    case "xs2x": return `abap.XFit(${x}, ${e.to.len})`;
    case "d2i": return `abap.DToI(${x})`;
    case "c2n":
      if (to === "f") return `abap.ParseF(${x})`;
      if (to === "i") return `abap.ParseI(${x})`;
      break;
    default: break;
  }
  throw new Error(`no Go for conversion ${e.kind} ${from}->${to}`);
}

function fn(e, ctx) {
  const args = e.args.map((a) => expr(a, ctx));
  if (FN_F[e.name]) return `${FN_F[e.name]}(${args[0]})`;
  const k = e.type.k;
  if (e.args[0]?.type.k === "p") {
    const P_FN = {ABS: "abap.AbsP", SIGN: "abap.SignP", CEIL: "abap.CeilP", FLOOR: "abap.FloorP", TRUNC: "abap.TruncP", FRAC: "abap.FracP"};
    if (P_FN[e.name]) return `${P_FN[e.name]}(${args[0]})`;
  }
  switch (e.name) {
    case "NMAX": return k === "i" ? `abap.MaxI(${args.join(", ")})` : `abap.MaxF(${args.join(", ")})`;
    case "NMIN": return k === "i" ? `abap.MinI(${args.join(", ")})` : `abap.MinF(${args.join(", ")})`;
    case "ABS": return k === "i" ? `abap.AbsI(${args[0]})` : `math.Abs(${args[0]})`;
    case "SIGN": return k === "i" ? `abap.SignI(${args[0]})` : `abap.SignF(${args[0]})`;
    case "FLOOR": return k === "i" ? args[0] : `math.Floor(${args[0]})`;
    case "CEIL": return k === "i" ? args[0] : `math.Ceil(${args[0]})`;
    case "TRUNC": return k === "i" ? args[0] : `math.Trunc(${args[0]})`;
    case "FRAC": return k === "i" ? "int32(0)" : `abap.FracF(${args[0]})`;
    default: throw new Error(`no Go for function ${e.name}`);
  }
}

function cond(c, ctx) {
  switch (c.c) {
    case "co": return `abap.CO(${expr(c.l, ctx)}, ${expr(c.r, ctx)})`;
    case "cs": return `abap.CS(${expr(c.l, ctx)}, ${expr(c.r, ctx)})`;
    case "cp": return `abap.CP(${expr(c.l, ctx)}, ${expr(c.r, ctx)}, ${!!c.cpat})`;
    case "ca": return `abap.CA(${expr(c.l, ctx)}, ${expr(c.r, ctx)})`;
    case "cmp":
      if (c.type?.k === "p") return `abap.CmpP(${expr(c.l, ctx)}, ${expr(c.r, ctx)}) ${c.op === "=" ? "==" : c.op === "<>" ? "!=" : c.op} 0`;
      return `${expr(c.l, ctx)} ${c.op === "=" ? "==" : c.op === "<>" ? "!=" : c.op} ${expr(c.r, ctx)}`;
    // in parentheses: a composite literal right before the { of an if does not parse
    case "initial":
      if (c.x.type.k === "data") return `abap.IsInitialData(${expr(c.x, ctx)})`;
      if (c.x.type.k === "dref") return `(${expr(c.x, ctx)}.P == nil)`;
      // a table is initial when it has no rows, whether its slice is nil or
      // an empty one (ultra/events: a converted table, make(T, 0))
      if (c.x.type.k === "table") return `(len(${expr(c.x, ctx)}) == 0)`;
      // a d, t or n field of a structure starts as "" (Go's zero), a
      // variable as its typed zero: both are initial
      if (["d", "t", "n"].includes(c.x.type.k)) return `abap.InitialCh(${expr(c.x, ctx)}, ${zero(c.x.type)})`;
      // a structure holding such a field: component by component
      if (c.x.type.k === "struct" && typedZeroInside(c.x.type)) return `abap.IsInitialOf(${expr(c.x, ctx)}, ${desc(c.x.type)})`;
      return `(${expr(c.x, ctx)} == ${zero(c.x.type)})`;
    // ultra/events: line_exists( ) and ref = ref (frontend lineExists, compareValues)
    case "line_exists": {
      const n = ctx.loop++;
      const keys = c.keys.map((k) => (k.line ? `r${n} == ${expr(k.value, ctx)}` : `r${n}.${ident(k.name)} == ${expr(k.value, ctx)}`)).join(" && ");
      return `func() bool { for _, r${n} := range ${expr(c.table, ctx)} { if ${keys} { return true } }; return false }()`;
    }
    case "same_ref": return `abap.SameRef(${expr(c.l, ctx)}, ${expr(c.r, ctx)})`;
    case "assigned": return c.fs.type.k === "data" ? `(${ident(c.fs.name)}.P != nil)` : `(${ident(c.fs.name)} != nil)`;
    case "and": return `(${cond(c.l, ctx)} && ${cond(c.r, ctx)})`;
    case "or": return `(${cond(c.l, ctx)} || ${cond(c.r, ctx)})`;
    case "not": return `!(${cond(c.x, ctx)})`;
    default: throw new Error(`no Go for condition ${c.c}`);
  }
}

/** Call(name, session, args) for the numeric harness: numbers in, a number out */
function dispatcher(classes) {
  const lines = ["// Call runs one static method by name with numeric arguments, for the harness.",
    "func Call(name string, s *abap.Session, args []float64) float64 {", "\tswitch name {"];
  for (const cls of classes) {
    for (const m of cls.methods) {
      if (!m.static || m.returning === null || !["i", "f"].includes(m.returning.type.k)) continue;
      if (m.params.some((p) => p.dir !== "importing" || !["i", "f"].includes(p.type.k))) continue;
      const args = m.params.map((p, i) => (p.type.k === "i" ? `int32(args[${i}])` : `args[${i}]`));
      lines.push(`\tcase "${cls.name}=>${m.name}":`, `\t\treturn float64(${funcName(cls.name, m.name)}(${["s", ...args].join(", ")}))`);
    }
  }
  lines.push("\t}", "\tpanic(\"unknown method \" + name)", "}");
  return lines;
}
