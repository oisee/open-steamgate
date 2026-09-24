// The AMDP corpus as eAMDP: every SQLScript body of an exported corpus
// created on a HANA (the local HANA Express), with an empty table of the
// right shape for each dictionary table it reads, so that HANA -- not our
// parser -- says whether the body is SQLScript it accepts. What comes out
// is a second oracle for the portable compiler: a body HANA accepts and we
// cannot parse is a gap in our grammar, named by where our parser stopped.
//
//   node tools/amdp-corpus-oracle.mjs [--export <dir>] [--ddic <dir>]... [--passes n]
//
// The HANA it talks to is amdp-run's (HXE_HOST / HXE_PORT / HXE_PASSWORD or
// the password file). It works in ONE schema, OSD_CORPUS, which it drops
// and recreates at the start of every run and never leaves; statements go
// one at a time, each with a timeout, since the database shares its host.
//
// The report goes to .local/amdp-oracle/ only: HANA's messages name the
// corpus's objects, and corpus names stay local (CLAUDE.md). What is printed
// is counts and classes.
//
// A refusal is sorted into the class that says whose fault it is:
//   missing    an object the body needs is still not there when no pass makes
//              progress (a table not in the dictionary, a CDS view not
//              reconstructed, a procedure not in the corpus)
//   ddic-type  our DDIC -> HANA type mapping has no answer for a type
//   ours-table a table we meant to reconstruct and could not create
//   signature  HANA refused the procedure head we wrote, not the body
//   shape      a column or type mismatch -- often the table or type we
//              reconstructed, not the body
//   hxe-refuses a syntax or semantic refusal inside the body. Every body of
//              the corpus is active on the system it came from, so this is
//              never a fact about the body alone: it is our stand, or a
//              difference between this HANA and that one
//   other      anything else, with the message
//
// The kernel's form of a procedure was read off A4H; the form of a function
// and of a table function here is ours, not read off a system.
import {mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync} from "node:fs";
import {join} from "node:path";
import {measure} from "./sqlscript/coverage.mjs";
import {resolveType} from "./osd-type-graph.mjs";
import {connection} from "./amdp-run.mjs";
import {compileProcedure} from "./sqlscript-to-procedure-ir.mjs";
import {runsAs} from "./osd-main.mjs";

export const SCHEMA = "OSD_CORPUS";
const upper = (v) => String(v ?? "").toUpperCase().trim();
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

export class TypeGap extends Error {}

// every class's and interface's own types, by owner: read from their
// sources here, since amdp-extract's reader takes only BEGIN OF and TABLE OF
// and a signature also uses `TYPES x TYPE c LENGTH 256`, chained TYPES:, and
// another owner's type as OWNER=>TYPE
const CLASS_TYPES = new Map();

/** ABAP source without comments, as statements */
function statementsOf(source) {
  const lines = String(source).split("\n").filter((line) => !line.startsWith("*"))
    .map((line) => {
      let out = "";
      let quote;
      for (const ch of line) {
        if (quote !== undefined) { out += ch; if (ch === quote) quote = undefined; continue; }
        if (ch === "'" || ch === "`") { quote = ch; out += ch; continue; }
        if (ch === '"') break;
        out += ch;
      }
      return out;
    });
  const text = lines.join(" ");
  const out = [];
  let current = "";
  let quote;
  for (const ch of text) {
    if (quote !== undefined) { current += ch; if (ch === quote) quote = undefined; continue; }
    if (ch === "'" || ch === "`") { quote = ch; current += ch; continue; }
    if (ch === ".") { out.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  return out.filter((one) => one !== "");
}

/** the TYPES of one source: Map NAME -> {kind: "alias", of} | {kind: "table", of} | {kind: "structure", components} */
export function typesOfSource(source) {
  const types = new Map();
  for (const statement of statementsOf(source)) {
    const m = /^TYPES\b\s*:?\s*([\s\S]*)$/i.exec(statement);
    if (m === null) continue;
    let structure;
    for (const raw of m[1].split(",")) {
      const part = raw.trim().replace(/\s+/g, " ");
      if (part === "") continue;
      let x = /^BEGIN OF (\w+)$/i.exec(part);
      if (x !== null) { structure = {name: upper(x[1]), components: []}; continue; }
      x = /^END OF (\w+)$/i.exec(part);
      if (x !== null) { if (structure !== undefined) types.set(structure.name, {kind: "structure", components: structure.components}); structure = undefined; continue; }
      if (structure !== undefined) {
        // the old length form: `priority(2) TYPE n`, and `name(10)` alone,
        // whose type is c
        x = /^(\w+)\((\d+)\)(?: TYPE (\w+))?$/i.exec(part);
        if (x !== null) { structure.components.push({name: x[1], abapType: `${x[3] ?? "c"} LENGTH ${x[2]}`}); continue; }
        x = /^(\w+) TYPE (.+)$/i.exec(part);
        if (x !== null) structure.components.push({name: x[1], abapType: x[2].trim()});
        else structure.components.push({name: part, abapType: "", unreadable: true});
        continue;
      }
      x = /^(\w+) TYPE (?:STANDARD |SORTED |HASHED )?TABLE OF ([\w\/=>-]+)/i.exec(part);
      if (x !== null) { types.set(upper(x[1]), {kind: "table", of: upper(x[2])}); continue; }
      x = /^(\w+)\((\d+)\)(?: TYPE (\w+))?$/i.exec(part);
      if (x !== null) { types.set(upper(x[1]), {kind: "alias", of: `${x[3] ?? "c"} LENGTH ${x[2]}`}); continue; }
      x = /^(\w+) TYPE (.+)$/i.exec(part);
      if (x !== null && !/\bRANGE OF\b|\bREF TO\b/i.test(x[2])) types.set(upper(x[1]), {kind: "alias", of: x[2].trim()});
    }
  }
  return types;
}

/** read every class and interface source under the given folders into CLASS_TYPES */
export function readOwnerTypes(folders) {
  for (const folder of folders) {
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder, {recursive: true}).map(String)) {
      const m = /([^\/]+)\.(clas|intf)(?:\.locals_def|\.locals_imp)?\.abap$/.exec(file);
      if (m === null) continue;
      const owner = upper(m[1].replace(/#/g, "/"));
      const mine = CLASS_TYPES.get(owner) ?? new Map();
      for (const [k, v] of typesOfSource(readFileSync(join(folder, file), "utf8"))) mine.set(k, v);
      CLASS_TYPES.set(owner, mine);
    }
  }
}

/**
 * Table shapes read off a system's HANA catalog (SYS.TABLE_COLUMNS /
 * SYS.VIEW_COLUMNS), one `T:NAME:COL/TYPE/LEN/SCALE;...` line per object and
 * `+` lines continuing the one before: the kernel's own column types, which
 * win over a reconstruction from the dictionary. An object with no columns
 * is kept out (its SQL name on the system is another).
 */
export function readCatalog(text) {
  const joined = String(text ?? "").split("\n").reduce((lines, line) => {
    if (line.startsWith("+") && lines.length > 0) lines[lines.length - 1] += line.slice(1);
    else if (line.startsWith("T:")) lines.push(line);
    return lines;
  }, []);
  const out = new Map();
  for (const line of joined) {
    const [, name, cols] = /^T:([^:]+):(.*)$/.exec(line) ?? [];
    if (name === undefined) continue;
    const columns = cols.split(";").filter((c) => c !== "").map((c) => {
      const [col, type, len, scale] = c.split("/");
      const t = upper(type);
      const hana = ["NVARCHAR", "VARCHAR", "VARBINARY", "ALPHANUM", "NCHAR", "CHAR"].includes(t) ? `${t}(${len})`
        : t === "DECIMAL" && Number(len) > 0 ? `DECIMAL(${len}, ${scale})` : t;
      return {name: upper(col), type: hana};
    });
    if (columns.length > 0) out.set(upper(name), columns);
  }
  return out;
}
let CATALOG = new Map();

/**
 * Dictionary objects read off a system (DD04L / DD40L / DD03L / DD01L) that
 * the export does not carry, in the same line format: `E:` an element's
 * DATATYPE/LENG/DECIMALS/DOMAIN, `Y:` a table type's ROWTYPE/ROWKIND/...,
 * `S:` a structure's fields FIELD/DATATYPE/LENG/DECIMALS/ELEMENT, `D:` a
 * domain's DATATYPE/LENG/DECIMALS.
 */
export function readExtraDdic(text) {
  const joined = String(text ?? "").split("\n").reduce((lines, line) => {
    if (line.startsWith("+") && lines.length > 0) lines[lines.length - 1] += line.slice(1);
    else if (/^[EYSD]:/.test(line)) lines.push(line);
    return lines;
  }, []);
  const extra = {elements: new Map(), ttyp: new Map(), struct: new Map(), doms: new Map()};
  for (const line of joined) {
    const [, kind, name, rest] = /^([EYSD]):([^:]+):(.*)$/.exec(line) ?? [];
    if (kind === undefined) continue;
    const n = upper(name);
    if (kind === "E" || kind === "D") {
      const [DATATYPE, LENG, DECIMALS] = rest.split("/");
      (kind === "E" ? extra.elements : extra.doms).set(n, {NAME: n, KIND: "DTEL", DATATYPE, LENG: Number(LENG), DECIMALS: Number(DECIMALS)});
    } else if (kind === "Y") {
      extra.ttyp.set(n, upper(rest.split("/")[0]));
    } else {
      extra.struct.set(n, rest.split(";").filter((f) => f !== "" && !f.startsWith(".")).map((f) => {
        const [NAME, DATATYPE, LENG, DECIMALS] = f.split("/");
        return {NAME: upper(NAME), DATATYPE, LENG: Number(LENG), DECIMALS: Number(DECIMALS)};
      }));
    }
  }
  return extra;
}
let EXTRA = {elements: new Map(), ttyp: new Map(), struct: new Map(), doms: new Map()};

/** resolveType, with what the export lacks filled in from EXTRA */
function resolveTypeX(store, name) {
  const key = upper(name);
  const found = resolveType(store, key);
  if (found.KIND === "DTEL" && found.DATATYPE === "" ) {
    const d = EXTRA.doms.get(upper(found.DOMAIN)) ?? EXTRA.elements.get(key);
    if (d !== undefined) return {...found, DATATYPE: d.DATATYPE, LENG: d.LENG, DECIMALS: d.DECIMALS};
  }
  if (found.KIND !== "UNRESOLVED" && !(found.KIND === "DTEL" && found.DATATYPE === "")) return found;
  if (found.KIND === "UNRESOLVED" && /domain (\S+) is not in this tree/.test(found.REASON ?? "")) {
    const dom = /domain (\S+) is not/.exec(found.REASON)[1];
    const d = EXTRA.doms.get(upper(dom)) ?? EXTRA.elements.get(key);
    if (d !== undefined) return {NAME: key, KIND: "DTEL", DATATYPE: d.DATATYPE, LENG: d.LENG, DECIMALS: d.DECIMALS};
  }
  if (EXTRA.elements.has(key)) return EXTRA.elements.get(key);
  if (EXTRA.ttyp.has(key)) {
    const row = EXTRA.ttyp.get(key);
    return {NAME: key, KIND: "TABLE", ROWTYPE: row, ROW: resolveTypeX(store, row)};
  }
  if (EXTRA.struct.has(key)) return {NAME: key, KIND: "STRUCTURE", FIELDS: EXTRA.struct.get(key)};
  return found;
}

/** a DDIC DATATYPE / LENG / DECIMALS as the HANA column type the kernel creates */
export function hanaOfDdic({DATATYPE, LENG, DECIMALS}, what = "a DDIC type") {
  const t = upper(DATATYPE);
  const len = Number(LENG ?? 0);
  const dec = Number(DECIMALS ?? 0);
  if (["CHAR", "CLNT", "CUKY", "LANG", "UNIT", "NUMC", "ACCP", "LCHR", "DATS", "TIMS"].includes(t)) {
    if (len <= 0) throw new TypeGap(`${what}: ${t} without a length`);
    return `NVARCHAR(${len})`;
  }
  if (t === "SSTR") return len > 0 ? `NVARCHAR(${len})` : "NVARCHAR(5000)";
  if (t === "STRG") return "NCLOB";
  if (t === "INT1") return "TINYINT";
  if (t === "INT2") return "SMALLINT";
  if (t === "INT4") return "INTEGER";
  if (t === "INT8") return "BIGINT";
  if (["DEC", "CURR", "QUAN", "DF16_DEC", "DF34_DEC"].includes(t)) return `DECIMAL(${len}, ${dec})`;
  if (t === "FLTP") return "DOUBLE";
  if (t === "RAW") return `VARBINARY(${len})`;
  if (["RSTR", "LRAW"].includes(t)) return "BLOB";
  if (["D16D", "D16R", "D16S", "DF16_RAW", "DF16_SCL"].includes(t)) return "SMALLDECIMAL";
  if (["D34D", "D34R", "D34S", "DF34_RAW", "DF34_SCL"].includes(t)) return "DECIMAL";
  if (t === "UTCL") return "TIMESTAMP";
  if (t === "DATN") return "DATE";
  if (t === "TIMN") return "TIME";
  throw new TypeGap(`${what}: DDIC datatype ${t || "<none>"} has no HANA mapping here`);
}

// data elements every system has, which an export of some packages does not
// carry: their types are fixed by the kernel, not by a package
const WELL_KNOWN = {MANDT: "NVARCHAR(3)", SPRAS: "NVARCHAR(1)", SYSUBRC: "INTEGER", SYDATUM: "NVARCHAR(8)",
  SYUZEIT: "NVARCHAR(6)", SYUNAME: "NVARCHAR(12)", SYSYSID: "NVARCHAR(8)", SYLANGU: "NVARCHAR(1)",
  SYMANDT: "NVARCHAR(3)", XFELD: "NVARCHAR(1)", BOOLE_D: "NVARCHAR(1)", ABAP_BOOLEAN: "NVARCHAR(1)",
  TIMESTAMP: "DECIMAL(15, 0)", TIMESTAMPL: "DECIMAL(21, 7)", SYSUUID_X16: "VARBINARY(16)",
  SYSUUID_C32: "NVARCHAR(32)", SYSUUID_C22: "NVARCHAR(22)", UNAME: "NVARCHAR(12)", SYST_UNAME: "NVARCHAR(12)"};
const SYST = {MANDT: "NVARCHAR(3)", DATUM: "NVARCHAR(8)", UZEIT: "NVARCHAR(6)", LANGU: "NVARCHAR(1)",
  UNAME: "NVARCHAR(12)", SYSID: "NVARCHAR(8)", TABIX: "INTEGER", DBCNT: "INTEGER", SUBRC: "INTEGER",
  DATLO: "NVARCHAR(8)", TIMLO: "NVARCHAR(6)", ZONLO: "NVARCHAR(6)"};

/** an ABAP built-in type text (`i`, `c LENGTH 10`, `abap.char(3)`, ...) as a HANA type, or undefined */
function hanaOfBuiltin(text) {
  const t = upper(text);
  const simple = {I: "INTEGER", INT4: "INTEGER", INT8: "BIGINT", INT2: "SMALLINT", INT1: "TINYINT",
    STRING: "NCLOB", XSTRING: "BLOB", F: "DOUBLE", D: "NVARCHAR(8)", T: "NVARCHAR(6)", C: "NVARCHAR(1)",
    N: "NVARCHAR(1)", ABAP_BOOL: "NVARCHAR(1)", UTCLONG: "TIMESTAMP", DECFLOAT16: "SMALLDECIMAL",
    DECFLOAT34: "DECIMAL", X: "VARBINARY(1)"};
  if (simple[t] !== undefined) return simple[t];
  if (t === "INTEGER") return "INTEGER";
  let sy = /^(?:SY|SYST)-(\w+)$/.exec(t);
  if (sy !== null) return SYST[sy[1]];
  if (WELL_KNOWN[t] !== undefined) return WELL_KNOWN[t];
  let m = /^(?:C|N)\s+LENGTH\s+(\d+)$/.exec(t) ?? /^(?:CHAR|NUMC)(\d+)$/.exec(t);
  if (m !== null) return `NVARCHAR(${m[1]})`;
  m = /^X\s+LENGTH\s+(\d+)$/.exec(t);
  if (m !== null) return `VARBINARY(${m[1]})`;
  m = /^P(?:\s+LENGTH\s+(\d+))?(?:\s+DECIMALS\s+(\d+))?$/.exec(t);
  if (m !== null) return `DECIMAL(${2 * Number(m[1] ?? 8) - 1}, ${Number(m[2] ?? 0)})`;
  m = /^ABAP\.(\w+)(?:\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?$/.exec(t);
  if (m !== null) {
    const map = {CHAR: "CHAR", NUMC: "NUMC", CLNT: "CLNT", LANG: "LANG", DATS: "DATS", TIMS: "TIMS", CUKY: "CUKY",
      UNIT: "UNIT", INT1: "INT1", INT2: "INT2", INT4: "INT4", INT8: "INT8", DEC: "DEC", CURR: "CURR", QUAN: "QUAN",
      FLTP: "FLTP", STRING: "STRG", SSTRING: "SSTR", RAW: "RAW", RAWSTRING: "RSTR", UTCLONG: "UTCL", DATN: "DATN", TIMN: "TIMN"};
    const fixed = {CLNT: 3, LANG: 1, DATS: 8, TIMS: 6, CUKY: 5};
    const ddic = map[m[1]];
    if (ddic === undefined) return undefined;
    return hanaOfDdic({DATATYPE: ddic, LENG: m[2] ?? fixed[m[1]] ?? 0, DECIMALS: m[3] ?? 0}, text);
  }
  return undefined;
}

/** the columns of a DDIC structure or table, [{name, type}] */
function ddicColumns(store, name) {
  const found = resolveTypeX(store, name);
  if (found.KIND !== "STRUCTURE") return undefined;
  return found.FIELDS.map((field) => {
    if (field.REASON !== undefined) throw new TypeGap(`${name}.${field.NAME}: ${field.REASON}`);
    // a field typed by a data element carries it resolved under TYPE
    let typed = field.ELEMENT !== undefined ? field.TYPE : field;
    if (field.ELEMENT !== undefined && (typed?.KIND === "UNRESOLVED" || typed?.DATATYPE === "")) typed = resolveTypeX(store, field.ELEMENT);
    if (typed?.KIND === "UNRESOLVED") {
      const known = WELL_KNOWN[upper(field.ELEMENT)];
      if (known !== undefined) return {name: upper(field.NAME), type: known};
      throw new TypeGap(`${name}.${field.NAME}: element ${field.ELEMENT}: ${typed.REASON}`);
    }
    return {name: upper(field.NAME), type: hanaOfDdic(typed, `${name}.${field.NAME}`)};
  });
}

/**
 * The HANA type of one AMDP parameter: a scalar type, or `TABLE (...)` for a
 * table type -- the class's own (`types`, amdp-extract's reading) or a
 * dictionary one.
 */
export function hanaParameterType(abapType, types, store) {
  const name = upper(abapType);
  const builtin = hanaOfBuiltin(name);
  if (builtin !== undefined) return builtin;
  if (name.includes("=>")) {
    const [owner, inner] = name.split("=>");
    const theirs = CLASS_TYPES.get(owner);
    if (theirs?.has(inner)) return hanaParameterType(inner, theirs, store);
    throw new TypeGap(`${name}: the types of ${owner} are not in this corpus`);
  }
  const local = types?.get?.(name);
  // a scalar component or row: built-in, an alias of this owner, another
  // owner's type, or a data element
  const scalarOf = (text) => {
    const t = upper(text);
    const b = hanaOfBuiltin(t);
    if (b !== undefined) return b;
    const alias = types?.get?.(t);
    if (alias?.kind === "alias") return scalarOf(alias.of);
    if (t.includes("=>")) {
      const [owner, inner] = t.split("=>");
      const theirs = CLASS_TYPES.get(owner)?.get(inner);
      if (theirs?.kind === "alias") return scalarOf(theirs.of);
      if (theirs === undefined) {
        const d = resolveTypeX(store, inner);
        if (d.KIND === "DTEL") return hanaOfDdic(d, text);
      }
      throw new TypeGap(`${text} is not a scalar this corpus declares`);
    }
    // `struct-field`: the type of one component -- a structure of this
    // owner, another owner's (`if_x=>ty_s-f`), or a table of the dictionary
    const component = /^([\w\/]+(?:=>[\w\/]+)?)-([\w\/]+)$/.exec(t);
    if (component !== null && !/^(?:SY|SYST)$/.test(component[1])) {
      const [, owner, field] = component;
      const row = owner.includes("=>") ? CLASS_TYPES.get(owner.split("=>")[0])?.get(owner.split("=>")[1]) : types?.get?.(owner);
      if (row?.kind === "structure") {
        const c = row.components.find((one) => upper(one.name) === field);
        if (c !== undefined && !c.unreadable) {
          return owner.includes("=>") ? hanaParameterType(c.abapType, CLASS_TYPES.get(owner.split("=>")[0]), store) : scalarOf(c.abapType);
        }
      }
      const columns = ddicColumns(store, owner.split("=>").pop());
      const column = columns?.find((one) => one.name === field);
      if (column !== undefined) return column.type;
    }
    const d = resolveTypeX(store, t);
    if (d.KIND === "DTEL" || d.KIND === "BUILTIN") return hanaOfDdic(d, text);
    const known = WELL_KNOWN[t];
    if (known !== undefined) return known;
    throw new TypeGap(`${text} is ${d.KIND}${d.REASON ? `: ${d.REASON}` : ""}`);
  };
  const structureColumns = (rowName) => {
    const row = types?.get?.(upper(rowName)) ?? (upper(rowName).includes("=>")
      ? CLASS_TYPES.get(upper(rowName).split("=>")[0])?.get(upper(rowName).split("=>")[1]) : undefined);
    if (row?.kind === "structure") {
      return row.components.map((c) => {
        if (c.unreadable) throw new TypeGap(`${rowName}: a component this reader does not take: ${c.name}`);
        if (/^INCLUDE TYPE/i.test(c.name)) throw new TypeGap(`${rowName}: INCLUDE TYPE is not read here`);
        return {name: upper(c.name), type: scalarOf(c.abapType)};
      });
    }
    return ddicColumns(store, upper(rowName).split("=>").pop());
  };
  if (local !== undefined) {
    if (local.kind === "alias") return hanaParameterType(local.of, types, store);
    if (local.kind === "table") {
      const cols = structureColumns(local.of);
      if (cols !== undefined) return `TABLE (${cols.map((c) => `${quote(c.name)} ${c.type}`).join(", ")})`;
      return `TABLE (${quote("TABLE_LINE")} ${scalarOf(local.of)})`;
    }
    throw new TypeGap(`${name} is a local ${local.kind}, not a table type or a scalar`);
  }
  // `struct-field` is always a scalar: the component's type
  if (/^[\w\/]+(?:=>[\w\/]+)?-[\w\/]+$/.test(name)) return scalarOf(abapType);
  const d = resolveTypeX(store, name);
  if (d.KIND === "DTEL") return hanaOfDdic(d, name);
  if (d.KIND === "TABLE") {
    if (d.ROW?.KIND === "STRUCTURE") {
      const cols = ddicColumns(store, d.ROWTYPE);
      return `TABLE (${cols.map((c) => `${quote(c.name)} ${c.type}`).join(", ")})`;
    }
    if (d.ROW?.KIND === "DTEL" || d.ROW?.KIND === "BUILTIN") return `TABLE (${quote("TABLE_LINE")} ${hanaOfDdic(d.ROW, d.ROWTYPE)})`;
    throw new TypeGap(`${name}: row type ${d.ROWTYPE} is ${d.ROW?.KIND ?? "missing"}`);
  }
  throw new TypeGap(`${name} is ${d.KIND}${d.REASON ? `: ${d.REASON}` : ""}`);
}

/** the CREATE statement for one corpus body, the way amdp-destination writes one of ours */
export function createStatement(body, store) {
  const sig = body.signature;
  const name = `${quote(SCHEMA)}.${quote(`${upper(body.className)}=>${upper(sig.name)}`)}`;
  const params = (sig.parameters ?? []).map((p) => {
    const hana = hanaParameterType(p.abapType, body.types, store);
    return {...p, hana, dflt: defaultClause(p, hana)};
  });
  const language = upper(sig.language || "SQLSCRIPT");
  const stripped = withoutAbapCommentLines(String(sig.body ?? body.body));
  // `$ABAP.type( x )` is an AMDP macro: the ABAP compiler writes x's HANA
  // type in its place before HANA sees the body
  const text = stripped.replace(/"?\$ABAP\.type\(\s*([^)]*?)\s*\)"?/gi, (all, inner) =>
    hanaParameterType(inner.replace(/^"|"$/g, ""), body.types, store));
  if (sig.tableFunction) {
    const returns = (sig.returns ?? []).map((c) => `${quote(upper(c.name))} ${hanaParameterType(c.abapType, body.types, store)}`);
    const args = params.filter((p) => p.direction === "IN").map((p) => `${p.name} ${p.hana}${p.dflt}`).join(", ");
    return [`CREATE FUNCTION ${name} (${args})`, `  RETURNS TABLE (${returns.join(", ")})`,
      `  LANGUAGE ${language}`, "  SQL SECURITY INVOKER", "  READS SQL DATA", "AS BEGIN", text, "END"].join("\n");
  }
  const returning = params.find((p) => p.direction === "RETURNING");
  if (returning !== undefined || upper(sig.dbKind) === "FUNCTION") {
    const args = params.filter((p) => p.direction === "IN").map((p) => `${p.name} ${p.hana}${p.dflt}`).join(", ");
    // a table comes back as `RETURNS TABLE (...)`, a scalar as `RETURNS name type`
    const out = params.filter((p) => p.direction === "RETURNING")
      .map((p) => (/^TABLE\b/.test(p.hana) ? p.hana : `${p.name} ${p.hana}`)).join(", ");
    return [`CREATE FUNCTION ${name} (${args})`, `  RETURNS ${out}`, `  LANGUAGE ${language}`,
      "  SQL SECURITY INVOKER", "  READS SQL DATA", "AS BEGIN", text, "END"].join("\n");
  }
  // the kernel's own form, read off a generated procedure on A4H
  // (SYS.PROCEDURES, 2026-09-24): a CHANGING table is `in "X__IN__"` and
  // `out "X"`, the body starts with `"X" = select * from :X__IN__;`, and
  // the method's body sits in a block of its own inside the procedure
  const args = [];
  const prologue = [];
  for (const p of params) {
    const table = /^TABLE\b/.test(p.hana);
    if (p.direction === "INOUT" && table) {
      const n = upper(p.name);
      args.push(`IN ${quote(`${n}__IN__`)} ${p.hana}`, `OUT ${quote(n)} ${p.hana}`);
      prologue.push(`${quote(n)} = SELECT * FROM :${quote(`${n}__IN__`)};`);
    } else {
      args.push(`${p.direction === "INOUT" ? "INOUT" : p.direction} ${p.name} ${p.hana}${p.direction === "IN" ? p.dflt : ""}`);
    }
  }
  return [`CREATE PROCEDURE ${name} (${args.join(", ")})`, `  LANGUAGE ${language}`, "  SQL SECURITY INVOKER",
    sig.readOnly ? "  READS SQL DATA" : "", "AS BEGIN", ...prologue, "BEGIN", text, "END;", "END"].filter((x) => x !== "").join("\n");
}

/**
 * The body as the kernel hands it to HANA: a full-line ABAP comment (`*` in
 * column one) is removed -- but not inside a SQLScript block comment, where
 * the line in column one that closes the comment (star, slash) is kept
 * (read off a generated procedure on A4H, 2026-09-24: its body ends with
 * `end if;`, that closing line, `end;`), and not inside a string. The SQLScript lexer draws the same line
 * (tools/sqlscript/lexer.mjs reads a block comment whole).
 */
export function withoutAbapCommentLines(text) {
  let out = "";
  let state = "code"; // code | block | line | string | quoted
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const lineStart = i === 0 || text[i - 1] === "\n";
    if (state === "code" && lineStart && c === "*") {
      while (i < text.length && text[i] !== "\n") i++;
      if (i < text.length) out += "\n";
      continue;
    }
    out += c;
    if (state === "code") {
      if (c === "-" && text[i + 1] === "-") state = "line";
      else if (c === "/" && text[i + 1] === "*") { out += "*"; i++; state = "block"; }
      else if (c === "'") state = "string";
      else if (c === '"') state = "quoted";
    } else if (state === "block") {
      if (c === "*" && text[i + 1] === "/") { out += "/"; i++; state = "code"; }
    } else if (state === "line") {
      if (c === "\n") state = "code";
    } else if (state === "string") {
      if (c === "'") { if (text[i + 1] === "'") { out += "'"; i++; } else state = "code"; }
    } else if (state === "quoted") {
      if (c === '"') state = "code";
    }
  }
  return out;
}

/**
 * The DEFAULT the kernel writes for an IN parameter, read off generated
 * procedures on A4H (SYS.PROCEDURES, 2026-09-24): an ABAP `DEFAULT 1` on an
 * INTEGER is `DEFAULT '1'` -- the literal's text, quoted -- and an optional
 * table parameter is `DEFAULT EMPTY`. Without it a caller that leaves the
 * parameter out is refused ("IV_X is not bound"), which the stand used to
 * count as HXE refusing the caller. A default that is a constant or a
 * system field (abap_true, sy-datum) is not measured and gets none.
 */
export function defaultClause(p, hana) {
  const table = /^TABLE\b/i.test(hana ?? "") || /#ttyp"?$/.test(hana ?? "");
  if (table) return p.optional || p.default !== undefined ? " DEFAULT EMPTY" : "";
  const text = p.default;
  if (text === undefined) return "";
  if (/^[-+]?\d+(?:\.\d+)?$/.test(text)) return ` DEFAULT '${text}'`;
  const quoted = /^'((?:[^']|'')*)'$/.exec(text);
  if (quoted !== null) return ` DEFAULT '${quoted[1]}'`;
  return "";
}

/** what a HANA error says is missing, or undefined */
export function missingObject(message) {
  const text = String(message ?? "");
  let m = /Could not find table\/view ([^\s]+) in schema/i.exec(text);
  if (m !== null) return {kind: "table", name: m[1].replace(/^"|"$/g, "")};
  m = /invalid table name:\s+([^\s:]+)/i.exec(text);
  if (m !== null && !/Could not find/.test(text)) return {kind: "table", name: m[1].replace(/^"|"$/g, "")};
  m = /(?:invalid name of function or procedure|Could not find (?:procedure|function))[:\s]+"?([^\s":]+(?:=>[^\s":]+)?)"?/i.exec(text);
  if (m !== null) return {kind: "routine", name: m[1]};
  return undefined;
}

/** a HANA refusal sorted into the class that says whose fault it is */
export function classify(message, headLines = 0) {
  const text = String(message ?? "");
  if (missingObject(text) !== undefined) return "missing";
  // a HANA repository object (sap.hana.*) in a schema of its own: outside ABAP
  if (/invalid schema name/i.test(text)) return "missing";
  if (/invalid column name|column .* not found|inconsistent datatype|type mismatch|scalar type/i.test(text)) return "shape";
  const line = Number(/line (\d+) col/.exec(text)?.[1] ?? 0);
  if (headLines > 0 && line > 0 && line <= headLines) return "signature";
  if (/sql syntax error|incorrect syntax|feature not supported|invalid (?:identifier|name|argument)|not allowed|wrong number|table variable|is not declared/i.test(text)) return "hxe-refuses";
  return "other";
}

const withTimeout = (promise, ms, what) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms: ${what}`)), ms);
  })]).finally(() => clearTimeout(timer));
};

/** our own verdict on a body: "OK" or the compiler's first refusal */
function ours(body, r) {
  try {
    compileProcedure({...body.signature, body: body.signature.body ?? body.body}, body.types ?? new Map(),
      {catalogue: body.catalogue, resolveType: r.dictionary.resolver(), store: r.dictionary});
    return "OK";
  } catch (error) {
    return String(error.message);
  }
}

/** where our parser stopped, as a grammar key: the word there and the one after */
function parseStop(body, why) {
  const m = /line (\d+) col (\d+)/.exec(why);
  if (m === null) return undefined;
  const line = String(body.body).split("\n")[Number(m[1]) - 1] ?? "";
  const rest = line.slice(Number(m[2]) - 1).trim();
  const words = rest.match(/^[:"]?[A-Za-z_][\w$#\/]*"?|^\S/g) ?? [];
  const next = rest.slice((words[0] ?? "").length).trim().match(/^[A-Za-z_][\w]*|^\S/)?.[0] ?? "";
  const shape = (w) => (w.startsWith(":") ? ":<var>" : w.startsWith('"') ? "<name>" : /^[A-Za-z_]/.test(w) && !/^(SELECT|FROM|WHERE|FOR|IN|DO|END|IF|THEN|ELSE|CALL|DECLARE|BEGIN|UNION|ALL|AS|ON|JOIN|INTO|WITH|CASE|WHEN|AND|OR|NOT|ORDER|GROUP|BY|TOP|LIMIT|RETURN|EXEC|EXECUTE|SIGNAL|RESIGNAL|CURSOR|OPEN|FETCH|CLOSE|WHILE|LOOP|BREAK|CONTINUE|ARRAY|TABLE|MAP_MERGE|APPLY_FILTER|CE_\w+|UNNEST|SEQUENTIAL|PARALLEL|EXECUTION|DISTINCT|OVER|PARTITION|INSERT|UPDATE|DELETE|UPSERT|MERGE|TRUNCATE|TOP|LATERAL|CROSS|OUTER|LEFT|RIGHT|INNER|FULL|USING|IS|NULL|BETWEEN|LIKE|EXISTS|ANY|SOME|HAVING|FILTER|WINDOW|RECORD_COUNT|ROWS|RANGE)$/i.test(w) ? "<name>" : upper(w));
  return `${shape(words[0] ?? "")} ${shape(next)}`.trim();
}

export async function runOracle({exportDir, ddic, passes = 12, timeoutMs = 60000, out, scratch, catalog, extraDdic}) {
  // the corpus's sources are unzipped under .local, not a world-readable /tmp
  scratch ??= join(out, "scratch");
  if (catalog !== undefined && existsSync(catalog)) CATALOG = readCatalog(readFileSync(catalog, "utf8"));
  if (extraDdic !== undefined && existsSync(extraDdic)) EXTRA = readExtraDdic(readFileSync(extraDdic, "utf8"));
  const r = measure(exportDir, scratch, {ddic});
  readOwnerTypes([scratch]);
  const bodies = r.bodies.working.filter((b) => b.language === "SQLSCRIPT" && b.signature)
    .map((b, i) => ({...b, types: CLASS_TYPES.get(upper(b.className)) ?? new Map(),
      key: `${upper(b.className)}=>${upper(b.signature.name)}#${i}`, routine: `${upper(b.className)}=>${upper(b.signature.name)}`}));
  const hdb = (await import("hdb")).default;
  const client = hdb.createClient(connection());
  await new Promise((resolve, reject) => client.connect((e) => (e ? reject(e) : resolve())));
  const exec = (sql) => withTimeout(new Promise((resolve, reject) =>
    client.exec(sql, (e, rows) => (e ? reject(e) : resolve(rows)))), timeoutMs, sql.slice(0, 60));
  const version = (await exec("SELECT VERSION FROM M_DATABASE"))[0]?.VERSION;
  const theirs = upper(process.env.HXE_SCHEMA ?? process.env.HANA_SCHEMA ?? "");
  if (theirs === SCHEMA) throw new Error(`HXE_SCHEMA / HANA_SCHEMA is ${SCHEMA}, the schema this tool drops: refused`);
  await exec(`DROP SCHEMA ${quote(SCHEMA)} CASCADE`).catch(() => undefined);
  await exec(`CREATE SCHEMA ${quote(SCHEMA)}`);
  await exec(`SET SCHEMA ${quote(SCHEMA)}`);

  const tables = new Map();       // name -> "created" | reason
  const created = [];             // routine keys, in the order HANA took them
  const result = new Map();       // body key -> {status, class?, message?}
  const ensureTable = async (name) => {
    const key = upper(name);
    if (tables.has(key)) return tables.get(key) === "created";
    let columns = CATALOG.get(key);
    try { columns ??= ddicColumns(r.dictionary, key); }
    catch (error) { tables.set(key, `ddic-type: ${error.message}`); return false; }
    if (columns === undefined) {
      const isCds = r.dictionary.lookup("DDLS", key) !== undefined;
      tables.set(key, isCds ? "a CDS view, not reconstructed yet" : "not in the dictionary");
      return false;
    }
    try {
      await exec(`CREATE COLUMN TABLE ${quote(key)} (${columns.map((c) => `${quote(c.name)} ${c.type}`).join(", ")})`);
      tables.set(key, "created");
      return true;
    } catch (error) {
      tables.set(key, `create failed: ${error.message}`);
      return false;
    }
  };

  let pending = bodies.slice();
  for (let pass = 1; pass <= passes && pending.length > 0; pass += 1) {
    const next = [];
    let progress = 0;
    for (const body of pending) {
      let statement;
      try { statement = createStatement(body, r.dictionary); }
      catch (error) {
        if (!(error instanceof TypeGap)) throw error;
        result.set(body.key, {status: "refused", class: "ddic-type", message: error.message});
        continue;
      }
      // two bodies of one routine name: the second would DROP the first
      if (created.some((key) => key.split("#")[0] === body.routine)) {
        result.set(body.key, {status: "refused", class: "other", message: "a second body of a routine already created"});
        continue;
      }
      // a missing table is made and the same body tried again, up to a bound
      let outcome;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          await exec(`DROP ${body.signature.tableFunction || upper(body.signature.dbKind) === "FUNCTION" || (body.signature.parameters ?? []).some((p) => p.direction === "RETURNING") ? "FUNCTION" : "PROCEDURE"} ${quote(body.routine)}`).catch(() => undefined);
          await exec(statement);
          outcome = {status: "created"};
          break;
        } catch (error) {
          const message = String(error.message ?? error);
          const missing = missingObject(message);
          if (missing?.kind === "table" && !tables.has(upper(missing.name)) && await ensureTable(missing.name)) continue;
          // a table we could not make is our failure, not the corpus's
          const made = missing?.kind === "table" ? tables.get(upper(missing.name)) : undefined;
          const klass = made?.startsWith("ddic-type") ? "ddic-type" : made?.startsWith("create failed") ? "ours-table"
            : classify(message, statement.slice(0, statement.indexOf("\nBEGIN\n") + 1).split("\n").length + 1);
          outcome = {status: "refused", class: klass, message, missing};
          break;
        }
      }
      outcome ??= {status: "refused", class: "other", message: "the bound of 40 tables made for one body was reached"};
      if (outcome.status === "created") {
        created.push(body.key);
        result.set(body.key, outcome);
        progress += 1;
      } else if (outcome.missing?.kind === "routine") {
        // perhaps a body not yet created; tried again in the next pass
        result.set(body.key, outcome);
        next.push(body);
      } else {
        result.set(body.key, outcome);
      }
    }
    console.log(`amdp-corpus-oracle: pass ${pass}: ${progress} created, ${next.length} waiting on a routine`);
    if (progress === 0) break;
    pending = next;
  }
  client.end();

  // our verdict beside HANA's
  const rows = bodies.map((body) => {
    const hana = result.get(body.key) ?? {status: "not tried"};
    const why = ours(body, r);
    return {key: body.key, hana: hana.status, class: hana.class, message: hana.message?.slice(0, 300),
      ours: why === "OK" ? "OK" : why.slice(0, 160), stop: why.startsWith("cannot parse") ? parseStop(body, why) : undefined};
  });
  const count = (f) => rows.filter(f).length;
  const classes = {};
  for (const row of rows.filter((x) => x.hana === "refused")) classes[row.class] = (classes[row.class] ?? 0) + 1;
  const gaps = {};
  for (const row of rows.filter((x) => x.hana === "created" && x.stop !== undefined)) gaps[row.stop] = (gaps[row.stop] ?? 0) + 1;
  const summary = {
    hana: version, bodies: rows.length,
    hanaCreated: count((x) => x.hana === "created"), hanaRefused: classes,
    oursCompile: count((x) => x.ours === "OK"),
    bothOk: count((x) => x.hana === "created" && x.ours === "OK"),
    hanaOkOursNot: count((x) => x.hana === "created" && x.ours !== "OK"),
    hanaOkOursCannotParse: count((x) => x.hana === "created" && x.stop !== undefined),
    oursOkHanaNot: count((x) => x.hana !== "created" && x.ours === "OK"),
    tablesCreated: [...tables.values()].filter((v) => v === "created").length,
    tablesMissing: [...tables.values()].filter((v) => v !== "created").length,
  };
  mkdirSync(out, {recursive: true});
  writeFileSync(join(out, "report.json"), JSON.stringify({summary, gaps, creationOrder: created, tables: Object.fromEntries(tables), rows}, undefined, 2));
  return {summary, gaps};
}

if (runsAs("amdp-corpus-oracle.mjs")) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const ddic = args.flatMap((a, i) => (a === "--ddic" ? [args[i + 1]] : []));
  const {summary, gaps} = await runOracle({
    exportDir: opt("--export", ".local/a4h-export"),
    ddic: ddic.length > 0 ? ddic : [".local/a4h-ddic"],
    passes: Number(opt("--passes", 12)),
    out: opt("--out", ".local/amdp-oracle"),
    catalog: opt("--catalog", ".local/amdp-oracle/a4h-catalog.txt"),
    extraDdic: opt("--extra-ddic", ".local/amdp-oracle/a4h-ddic-extra.txt"),
  });
  console.log(JSON.stringify(summary, undefined, 2));
  console.log("grammar gaps (HANA accepts, we stop there), by the word we stopped at:");
  for (const [key, n] of Object.entries(gaps).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(4)}  ${key}`);
}
