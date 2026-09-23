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
  const id = String(name).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return GO_RESERVED.has(id) || /^\d/.test(id) ? `${id}_` : id;
};
const typeName = (s) => String(s).toUpperCase().replace(/=>|~|-/g, "__").replace(/[^A-Z0-9_]/g, "_");
export const funcName = (cls, method) => `${typeName(cls)}_${typeName(method)}`;

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
    case "d": case "t": case "p": return "string";
    default: throw new Error(`no Go type for ${t.k}`);
  }
}

// an x field is always its full length: initial is that many 00 bytes
const zero = (t) => (t.k === "i" || t.k === "int8" || t.k === "f" ? "0" : t.k === "x" ? JSON.stringify("\u0000".repeat(t.len)).replaceAll("\\u0000", "\\x00")
  : t.k === "string" || t.k === "c" || t.k === "xstring" ? `""` : t.k === "struct" ? `${t.go}{}` : t.k === "data" || t.k === "dref" ? "abap.Data{}"
    : t.k === "d" ? `"00000000"` : t.k === "t" ? `"000000"` : t.k === "p" ? `"0"` : "nil");

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
    case "dref": return "abap.TRef";
    case "ref": case "exc": return "abap.TObj";
    case "struct": case "table": {
      const key = goType(t);
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
        inits.push(`\t*${d.name} = abap.Type{Kind: 'h', Row: ${desc(t.row)}, Lines: func(p any) int { return len(*p.(*${g})) }, At: func(p any, i int) any { return &(*p.(*${g}))[i] }, ${copyZero(t)}}`);
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

/** a structure that holds a string, a table or a reference, at any depth */
export function deepType(t) {
  if (["string", "xstring", "table", "ref", "exc", "dref", "data"].includes(t?.k)) return true;
  if (t?.k === "struct") return (STRUCTDEFS.get(t.go)?.fields ?? []).some((f) => deepType(f.type));
  return false;
}

/** the Copy and Zero of a generated descriptor: a whole move and a CLEAR through generic data */
function copyZero(t) {
  const g = goType(t);
  return `Copy: func(dst, src any) { *dst.(*${g}) = ${copied(`*src.(*${g})`, t)} }, Zero: func(p any) { *p.(*${g}) = ${zero(t)} }`;
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
    for (const a of inst) out.push(`\t${ident(a.name)} ${goType(a.type)}`);
    out.push("}", "");
    if (POLY.has(cls.name)) out.push(...classInterface(program, cls));
    for (const a of (cls.attributes ?? []).filter((x) => x.static && !x.unsupported)) {
      out.push(`var ${typeName(`${cls.name}=>${a.name}`)} ${goType(a.type)}${a.value === undefined ? "" : ` = ${constLiteral(a)}`}`);
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
      `\to := Alloc_${typeName(cls.name)}()`,
      ...(ctorAt?.constructor ? [`\to.CONSTRUCTOR(${["s", ...cp.map((p) => ident(p.name))].join(", ")})`] : []),
      "\treturn o", "}", "");
    // CREATE OBJECT ... TYPE (name) passes no arguments
    const make = cp.length === 0 ? `return New_${typeName(cls.name)}(s)`
      : `panic(abap.NotCompiled(${JSON.stringify(`${cls.name}=>CONSTRUCTOR`)}, "CREATE OBJECT by name of a class whose constructor has parameters"))`;
    out.push(`func init() {`, `\tabap.RegisterClass(${JSON.stringify(cls.name)}, (*${typeName(cls.name)})(nil), func(s *abap.Session) any { ${make} })`, "}", "");
  }
  out.push(...dispatcher(classes));
  out.push(...staticRegistry(program, classes));
  if (classes.some((c) => c.methods.some((m) => m.body?.[0]?.s === "native"))) out.push(...nativeRtti(program));
  // descriptors first: their Copy asks for clone functions
  const descs = descFuncs();
  out.push(...cloneFuncs());
  out.push(...descs);
  // a RESET line becomes a //line back to this file at the line after it
  for (let i = 0; i < out.length; i += 1) if (out[i] === RESET) out[i] = `//line zz_generated.go:${i + 2}`;
  return out.join("\n") + "\n";
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
  for (const m of cls.signatures?.values() ?? []) {
    if (m.unsupported || m.static || m.private || m.name === "CONSTRUCTOR" || !definable(program, m)) continue;
    out.push(`\t${signature({name: cls.name}, m, true)}`);
  }
  out.push("}", "", `func (me *${T}) As_${T}() *${T} { return me }`, "");
  return out;
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
    case "field": return `${place(p.base, ctx)}.${ident(p.name)}`;
    case "fs": return p.type.k === "data" ? ident(p.name) : `(*${ident(p.name)})`;
    case "refattr": return POLY.has(p.base.type.name) && !p.base.type.intf ? `${expr(p.base, ctx)}.As_${typeName(p.base.type.name)}().${ident(p.name)}` : `${expr(p.base, ctx)}.${ident(p.name)}`;
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

function builders(body, ctx) {
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
  return [...names].filter((name) => !ctx.builders?.has(name) && appendsOnly(body, name));
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
function withBuilders(body, ctx, t, emitLoop) {
  const names = builders(body, ctx);
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
      return [`${t}${tb} = append(${tb}, ${copied(expr(st.value, ctx), st.value.type, st.value)})`, `${t}s.Sy.Tabix = int32(len(${tb}))`];
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
      if (!c.exceptions) return [`${t}${run}`];
      const m = Object.entries(c.exceptions.map).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(", ");
      return [`${t}func() {`, `${t}\tdefer abap.Classic(s, ${JSON.stringify(c.callee)}, map[string]int32{${m}}, ${c.exceptions.others})`,
        `${t}\t${run}`, `${t}\ts.Sy.Subrc = 0`, `${t}}()`];
    }
    case "native": {
      const m = ctx.method;
      return [`${t}${m.returning ? "return " : ""}${st.fn}(${["s", ...m.params.map((p) => ident(p.name))].join(", ")})`];
    }
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
    });
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
    });
    case "modify_index": {
      const n = `idx${ctx.loop++}`;
      const tb = place(st.table, ctx);
      return [`${t}if ${n} := ${expr(st.index, ctx)}; ${n} >= 1 && int(${n}) <= len(${tb}) {`,
        `${t}\t${tb}[${n}-1] = ${copied(expr(st.value, ctx), st.value.type, st.value)}`, `${t}\ts.Sy.Subrc = 0`, `${t}\ts.Sy.Tabix = ${n}`, `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    }
    case "split": return [`${t}${place(st.table, ctx)} = abap.Split(${expr(st.x, ctx)}, ${expr(st.sep, ctx)})`];
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
      const cases = st.catches.map((c) => [`${t}\t\t\tcase ok && (${c.covers.length ? c.covers.map((x) => `e.Class == ${JSON.stringify(x)}`).join(" || ") : "false"}):`,
        ...(c.into ? [`${t}\t\t\t\t${ident(c.into)} = &abap.Exception{Class: e.Class, Op: e.Op}`] : []),
        ...c.body.flatMap((x) => stmt(x, ctx, d + 4))]).flat();
      ctx.tries.pop();
      const out = [`${t}ctl${n} := func() (ctl int) {`, `${t}\tdefer func() {`, `${t}\t\tif r := recover(); r != nil {`, `${t}\t\t\te, ok := abap.AsError(r)`,
        `${t}\t\t\t_ = e`, `${t}\t\t\tswitch {`, ...cases, `${t}\t\t\tdefault:`, `${t}\t\t\t\tabap.Repanic(r, debug.Stack())`, `${t}\t\t\t}`, `${t}\t\t}`, `${t}\t}()`,
        ...body, `${t}\treturn 0`, `${t}}()`, `${t}_ = ctl${n}`];
      for (const code of [1, 2, 3]) if (frame.used.has(code)) out.push(`${t}if ctl${n} == ${code} {`, `${t}\t${leave(ctx, code)}`, `${t}}`);
      return out;
    }
    case "sort": {
      // SORT is not stable in ABAP; stable here, so equal keys keep their order
      const tb = place(st.table, ctx);
      const cmp = st.keys.map((k) => `if x.${ident(k.name)} != y.${ident(k.name)} { return x.${ident(k.name)} ${k.desc ? ">" : "<"} y.${ident(k.name)} }`);
      return [`${t}sort.SliceStable(${tb}, func(a, b int) bool { x, y := ${tb}[a], ${tb}[b]; ${cmp.join("; ")}; return false })`];
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
    case "replace_all": {
      const p = place(st.target, ctx);
      return [`${t}${p}, s.Sy.Subrc = abap.ReplaceAll(${p}, ${expr(st.of, ctx)}, ${expr(st.with, ctx)})`];
    }
    case "assert":
      return [`${t}if !(${cond(st.cond, ctx)}) {`, `${t}\tpanic(abap.ArithmeticError{Class: "ASSERTION_FAILED", Op: ${JSON.stringify(st.text)}})`, `${t}}`];
    case "assign_comp":
      return [`${t}if c, ok := abap.Component(${expr(st.from, ctx)}, ${expr(st.name, ctx)}); ok {`, `${t}\t${ident(st.fs.name)} = c`, `${t}\ts.Sy.Subrc = 0`,
        `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    case "assign_deref":
      return [`${t}if r := ${expr(st.ref, ctx)}; r.P != nil {`, `${t}\t${ident(st.fs.name)} = r`, `${t}\ts.Sy.Subrc = 0`, `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    case "assign_data":
      return [`${t}${ident(st.fs.name)} = ${expr(st.value, ctx)}`];
    // a move into generic data writes into the slot it is bound to
    case "set_data":
      return [`${t}abap.MoveData(${expr(st.target, ctx)}, ${expr(st.value, ctx)})`];
    case "clear_data":
      return [`${t}abap.ClearData(${expr(st.target, ctx)})`];
    case "get_ref":
      return [`${t}${place(st.target, ctx)} = ${expr(st.value, ctx)}`];
    case "describe_kind":
      return [`${t}${place(st.target, ctx)} = string(${expr(st.x, ctx)}.T.Kind)`];
    case "condense": {
      const p = place(st.target, ctx);
      return [`${t}${p} = abap.Condense(${p}, ${st.noGaps})`];
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
      const args = st.args.map((a) => (a.nil ? "nil" : a.mandt ? "abap.Mandt" : typeof a.value === "number" ? String(a.value) : JSON.stringify(String(a.value))));
      const slots = st.slots.map((sl) => {
        const fields = new Map((STRUCTDEFS.get(sl.range.type.row.go)?.fields ?? []).map((f) => [String(f.name).toUpperCase(), f]));
        const txt = (nm) => (fields.get(nm).type.k === "i" ? `abap.FmtI(r.${ident(fields.get(nm).name)})` : `r.${ident(fields.get(nm).name)}`);
        return `{Index: ${sl.index}, Col: ${JSON.stringify(sl.col)}, Rows: func() []abap.RangeRow { var out []abap.RangeRow; for _, r := range ${expr(sl.range, ctx)} { out = append(out, abap.RangeRow{Sign: r.${ident(fields.get("SIGN").name)}, Option: r.${ident(fields.get("OPTION").name)}, Low: ${txt("LOW")}, High: ${txt("HIGH")}}) }; return out }()}`;
      });
      const vars = st.cols.map((c, i) => `c${i}_${n} ${c.type.k === "i" ? "abap.DBInt" : "abap.DBString"}`);
      const moves = st.assign.map((a, i) => (a === null ? null
        : `${a.line ? "r" : `r.${ident(a.field)}`} = ${st.cols[i].type.k === "i" ? `abap.DBI(c${i}_${n})` : st.cols[i].type.k === "string" ? `abap.DBStr(c${i}_${n})` : `abap.DBChar(c${i}_${n})`}`)).filter(Boolean);
      return [`${t}${tgt} = nil`,
        `${t}if abap.Select(s, ${JSON.stringify(st.sql)}, []any{${args.join(", ")}}, []abap.Slot{${slots.join(", ")}}, func(scan func(dest ...any) error) {`,
        `${t}\tvar ${vars.join("\n" + t + "\tvar ")}`,
        `${t}\tabap.Must(scan(${st.cols.map((_, i) => `&c${i}_${n}`).join(", ")}))`,
        `${t}\tvar r ${rowGo}`, ...moves.map((m) => `${t}\t${m}`), `${t}\t${tgt} = append(${tgt}, r)`,
        `${t}}) > 0 {`, `${t}\ts.Sy.Subrc = 0`, `${t}} else {`, `${t}\ts.Sy.Subrc = 4`, `${t}}`];
    }
    case "create_dyn":
      return [`${t}${place(st.target, ctx)} = abap.CreateAs[${goType(st.target.type)}](s, ${expr(st.name, ctx)})`];
    case "read_key": {
      const tb = expr(st.table, ctx);
      const n = ctx.loop++;
      const cond = st.keys.map((k) => (k.line ? `r${n} == ${expr(k.value, ctx)}` : `r${n}.${ident(k.name)} == ${expr(k.value, ctx)}`)).join(" && ");
      if (st.into?.conv) throw new Error("READ TABLE INTO a work area of another type");
      const bind = st.fs ? `${ident(st.fs)} = &${tb}[i${n}]` : st.into ? `${place(st.into, ctx)} = ${copied(`r${n}`, st.into.type)}` : null;
      return [`${t}{`, `${t}\ts.Sy.Subrc = 4`, `${t}\tfor i${n}, r${n} := range ${tb} {`, `${t}\t\t_, _ = i${n}, r${n}`, `${t}\t\tif ${cond} {`,
        ...(bind ? [`${t}\t\t\t${bind}`] : []), `${t}\t\t\ts.Sy.Subrc = 0`, `${t}\t\t\ts.Sy.Tabix = ${st.hashed ? "0" : `int32(i${n} + 1)`}`,
        `${t}\t\t\tbreak`, `${t}\t\t}`, `${t}\t}`, `${t}}`];
    }
    case "find": {
      const lines = [`${t}{`, `${t}\tfok, foff, flen, fsub := abap.FindStmt(${expr(st.subject, ctx)}, ${expr(st.pattern, ctx)}, ${st.regex}, ${st.icase}, ${st.subs.length})`,
        `${t}\t_, _, _ = foff, flen, fsub`, `${t}\tif fok {`, `${t}\t\ts.Sy.Subrc = 0`];
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
    case "exit": return [`${t}${leave(ctx, 2)}`];
    case "continue": return [`${t}${leave(ctx, 3)}`];
    case "return": return [`${t}${leave(ctx, 1)}`];
    default: throw new Error(`no Go for statement ${st.s}`);
  }
}

const I_OPS = {"+": "abap.AddI", "-": "abap.SubI", "*": "abap.MulI", "/": "abap.DivI", DIV: "abap.DivIntI", MOD: "abap.ModI"};
const I8_OPS = {"+": "abap.AddI8", "-": "abap.SubI8", "*": "abap.MulI8", "/": "abap.DivI8", DIV: "abap.DivIntI8", MOD: "abap.ModI8"};
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
    case "sy": return `s.Sy.${e.field}`;
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
    case "neg": return e.type.k === "i" ? `abap.NegI(${expr(e.x, ctx)})` : `(-${expr(e.x, ctx)})`;
    case "bin":
      if (e.type.k === "x") return `abap.BitX(${JSON.stringify(e.op)}, ${expr(e.l, ctx)}, ${expr(e.r, ctx)})`;
      if (e.type.k === "i") return `${I_OPS[e.op]}(${expr(e.l, ctx)}, ${expr(e.r, ctx)})`;
      if (e.type.k === "int8") return `${I8_OPS[e.op]}(${expr(e.l, ctx)}, ${expr(e.r, ctx)})`;
      if (F_OPS[e.op] !== undefined) return `${F_OPS[e.op]}(${expr(e.l, ctx)}, ${expr(e.r, ctx)})`;
      if (e.op === "**") return `abap.PowF(${expr(e.l, ctx)}, ${expr(e.r, ctx)})`;
      return `(${expr(e.l, ctx)} ${e.op} ${expr(e.r, ctx)})`;
    case "conv": return conv(e, ctx);
    case "fn": return fn(e, ctx);
    case "lines": return `int32(len(${expr(e.table, ctx)}))`;
    case "strlen": return `abap.Strlen(${expr(e.x, ctx)})`;
    case "uccp": return `abap.Uccp(${expr(e.x, ctx)})`;
    case "exc_text": return `${expr(e.x, ctx)}.Text()`;
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
        : a.place === null ? `new(${goType(a.type)})` : `&${place(a.place, ctx)}`))];
      if (e.receiver) return `${expr(e.receiver, ctx)}.${typeName(e.method)}(${args.join(", ")})`;
      if (e.owner) return `${funcName(e.owner, e.method)}(${args.join(", ")})`;
      if (e.static) return `${funcName(ctx.cls.name, e.method)}(${args.join(", ")})`;
      // SUPER->m( ): the superclass's part, bound statically
      if (e.sup) return `me.${typeName(e.sup)}.${typeName(e.method)}(${args.join(", ")})`;
      return `${self(ctx, e.method)}.${typeName(e.method)}(${args.join(", ")})`;
    }
    case "nop_call": return "";
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
  return `abap.DataString(${d})`;
}

function templatePart(v, ctx, opts) {
  let out = templateValue(v, ctx, opts);
  if (opts.width !== undefined) out = `abap.Pad(${out}, ${opts.width}, ${JSON.stringify(opts.align ?? "LEFT")}, ${JSON.stringify(opts.pad ?? " ")})`;
  return out;
}

function templateValue(v, ctx, opts) {
  const x = expr(v, ctx);
  if (opts.decimals !== undefined) return `abap.FmtFDec(${x}, ${opts.decimals})`;
  switch (v.type.k) {
    case "i": return `abap.FmtI(${x})`;
    case "int8": return `abap.FmtI8(${x})`;
    case "f": return `abap.FmtF(${x})`;
    case "string": case "c": case "d": case "t": return x;
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
    case "num":
      if (from === "i" && to === "f") return `float64(${x})`;
      if (from === "f" && to === "i") return `abap.F2I(${x})`;
      if (from === "i" && to === "int8") return `int64(${x})`;
      if (from === "int8" && to === "i") return `abap.I8ToI(${x})`;
      if (from === "int8" && to === "f") return `float64(${x})`;
      if (from === "f" && to === "int8") return `abap.F2I8(${x})`;
      break;
    case "c2s": return x;
    case "s2c": return `abap.CFit(${x}, ${e.to.len})`;
    case "i2s": return `abap.IToString(${x})`;
    case "x2s": return `abap.XToHex(${x})`;
    case "i2x": return `abap.IToX(${x}, ${e.to.len})`;
    case "x2i": return `abap.XToI(${x})`;
    case "xs2x": return `abap.XFit(${x}, ${e.to.len})`;
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
    case "cmp": return `${expr(c.l, ctx)} ${c.op === "=" ? "==" : c.op === "<>" ? "!=" : c.op} ${expr(c.r, ctx)}`;
    // in parentheses: a composite literal right before the { of an if does not parse
    case "initial":
      if (c.x.type.k === "data") return `abap.IsInitialData(${expr(c.x, ctx)})`;
      if (c.x.type.k === "dref") return `(${expr(c.x, ctx)}.P == nil)`;
      return `(${expr(c.x, ctx)} == ${zero(c.x.type)})`;
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
