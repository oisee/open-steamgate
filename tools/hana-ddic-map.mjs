// DD03L -> our abapGit *.tabl.xml shape, as a pure function.
//
// tools/hana-ddic-probe.mjs reads DD02L/DD03L/DD04L/DD01L/DD02T out of a
// schema an SAP system already holds, through the hana-client (so identifier
// folding and the literal trim apply), and this module turns the rows into
// what the tree writes by hand: the DD03P entries of src/**/*.tabl.xml. It
// is pure so it is testable without a database (test/hana-ddic-map.mjs;
// its fixtures are named ZOSD_H1_* for the same reason the leak list
// exists).
//
// The mapping is faithful to what DD03L carries and to this tree's
// conventions, which were read off its fixtures rather than invented:
//
//   - INTTYPE and INTLEN are DD03L's own columns, carried for every field,
//     resolved or not: they are read from there and preferred over anything
//     derived. Only what DD03L leaves blank is derived -- INTLEN by the
//     rules further down, the way tools/segw-tables.mjs and
//     tools/dsl-l3-remote.mjs derive it (LENG x 2 for the character types
//     C/N/D/T -- so DATS 16 and TIMS 12, as
//     src/webgui/zosd_revision_s.tabl.xml spells them; the byte count for
//     RAW/LRAW/LCHR; 1/2/4/8 for INT1/INT2/INT4/INT8; (LENG+1)/2 rounded up
//     for packed; 8 for the string/lob references (g/y) and FLTP), INTTYPE
//     from the DATATYPE's letter. A type with no rule here is refused by
//     name, not guessed at -- the rule hana-client's own TYPE_CODES table
//     states. The descriptor carries which half of the pair it had to
//     derive (inttypeFrom/intlenFrom: "dd03l" or "derived"), and the probe
//     prints the derived fields by name.
//   - a CURR/QUAN field carries the field its value is measured in:
//     REFTABLE plus REFFIELD name the currency/unit field, and PRECFIELD
//     is DD03L's own position marker (for an .INCLUDE row it names the
//     include). DD03L is the only source -- neither DD04L nor DD01L knows
//     the table the field sits in -- and what the row leaves blank stays
//     absent, the way a system's own abapGit export writes it (DD03P's
//     component order: after INTLEN, before NOTNULL). Without them the
//     field went out packed with no reference at all: the XML did not
//     round-trip and --diff could not see reference drift.
//   - a field typed by a data element carries ROLLNAME and COMPTYPE E
//     beside its resolved types, which is what a system's own abapGit
//     export writes. An element with no type of its own resolves through
//     its domain (DD04L -> DD01L), the hop tools/adt-documents.mjs
//     documents and once missed.
//   - MANDT is the one field with a shape of its own, as segw-tables writes
//     it everywhere: the XML carries KEYFLAG, ROLLNAME MANDT, ADMINFIELD 0,
//     NOTNULL X, COMPTYPE E, and nothing else. The descriptor beside it also
//     carries the type DD03L names for the field (CLNT, LENG 3), because
//     --diff compares the client field against a system's own export, whose
//     DD03P does spell the type.
//   - an .INCLUDE row is not a field; it is refused by name so a table is
//     never emitted as the part of itself that happened to resolve (the
//     partial-schema mistake tools/osd-type-graph.mjs records).
//
// The XML itself is emitted by structureXml (tools/cds-computed.mjs) in its
// transport shape: one writer, two consumers.
import {structureXml} from "./cds-computed.mjs";

const pad = (n) => String(n).padStart(6, "0");

// DD03L row (the lower-case shape query() returns) -> our field descriptor:
// plain names for the tests and for the diff, padded strings where the XML
// wants them. `refs` carries the DD04L rows by ROLLNAME and the DD01L rows
// by DOMNAME, so the element and domain hops stay pure.
export function ddicField(row, refs = {}) {
  const fieldname = String(row.fieldname ?? "").toUpperCase();
  if (fieldname === "" || fieldname.startsWith(".")) return undefined;
  const key = String(row.keyflag ?? "").toUpperCase() === "X";
  const notnull = String(row.notnull ?? "").toUpperCase() === "X";
  const rollname = String(row.rollname ?? "").toUpperCase();
  const elements = refs.elements instanceof Map ? refs.elements : new Map();
  const domains = refs.domains instanceof Map ? refs.domains : new Map();
  // the client field, in the shape this tree writes it everywhere. The
  // descriptor also carries what DD03L says of the field's type, which
  // --diff compares: a system's own export spells DATATYPE/LENG on MANDT,
  // the XML's tags block does not, and stays as it is.
  if (fieldname === "MANDT") {
    const digits = Number(String(row.leng ?? "").trim() || 0);
    const decimals = Number(String(row.decimals ?? "").trim() || 0);
    return {fieldname, key, notnull: true, mandt: true,
      datatype: String(row.datatype ?? "").toUpperCase(),
      leng: pad(digits),
      ...(decimals > 0 ? {decimals: pad(decimals)} : {}),
      tags: {...(key ? {KEYFLAG: "X"} : {}), ROLLNAME: "MANDT", ADMINFIELD: "0", NOTNULL: "X", COMPTYPE: "E"}};
  }
  const element = elements.get(rollname);
  const domname = String(element?.domname ?? "").toUpperCase();
  const domain = domname === "" ? undefined : domains.get(domname);
  // the field's own row wins; the element, then the domain, fill what it
  // leaves empty
  const pick = (...sources) => {
    for (const value of sources) {
      if (value !== undefined && value !== null && String(value) !== "") return String(value);
    }
    return "";
  };
  const datatype = pick(row.datatype, element?.datatype, domain?.datatype).toUpperCase();
  if (datatype === "") {
    throw new Error(`hana-ddic-map: ${fieldname} has no type of its own and its data element ${rollname === "" ? "(none named)" : rollname} resolves to nothing`);
  }
  // INTTYPE and INTLEN are DD03L's own columns, for every field, resolved
  // or not -- so DD03L is the source and the element/domain hops fill only
  // what a blank leaves. (DD04L and DD01L do not carry the pair at all;
  // asking DD04L for INTTYPE was the guessed column the probe's first run
  // against a real system died on -- the measured column lists are pinned
  // by test/hana-ddic-probe.mjs.) The ABAP letters are case-significant:
  // lower-case g is STRING, y is XSTRING, b and s the small integers --
  // never folded.
  const inttypeOwn = String(row.inttype ?? "").trim();
  const inttype = inttypeOwn !== "" ? inttypeOwn : (INTTYPE_OF[datatype] ?? "");
  const inttypeFrom = inttypeOwn !== "" ? "dd03l" : (INTTYPE_OF[datatype] !== undefined ? "derived" : undefined);
  const digits = Number(pick(row.leng, element?.leng, domain?.leng) || 0);
  const decimals = Number(pick(row.decimals, element?.decimals, domain?.decimals) || 0);
  const intlenOwn = String(row.intlen ?? "").trim();
  const intlen = intlenOwn !== ""
    ? (/^\d+$/.test(intlenOwn) ? pad(Number(intlenOwn)) : intlenOwn)
    : intlenOf(fieldname, datatype, inttype, digits);
  const intlenFrom = intlenOwn !== "" ? "dd03l" : "derived";
  // the reference a CURR/QUAN field carries, exactly as DD03L says it --
  // REFTABLE and REFFIELD point at the currency/unit field, PRECFIELD is
  // the position marker (and an .INCLUDE row's name; ddicFields reads it
  // below). Blank stays absent: an empty tag is drift against what a
  // system's own export writes.
  const reftable = String(row.reftable ?? "").toUpperCase();
  const precfield = String(row.precfield ?? "").toUpperCase();
  const reffield = String(row.reffield ?? "").toUpperCase();
  return {
    fieldname, key, notnull, ...(rollname === "" ? {} : {rollname}),
    datatype, inttype, inttypeFrom, leng: pad(digits), intlen, intlenFrom,
    ...(reftable === "" ? {} : {reftable}),
    ...(precfield === "" ? {} : {precfield}),
    ...(reffield === "" ? {} : {reffield}),
    ...(decimals > 0 ? {decimals: pad(decimals)} : {}),
  };
}

// the ABAP letter a DATATYPE implies, consulted only when DD03L leaves
// INTTYPE blank. The letters are the ones the INTLEN rules below already
// state, so a derived letter and a derived INTLEN stay consistent with each
// other (LCHR under X, as that rule has always had it). A DATATYPE not
// named here leaves INTTYPE empty rather than guessed at.
const INTTYPE_OF = {
  CHAR: "C", CLNT: "C", CUKY: "C", UNIT: "C",
  NUMC: "N", ACCP: "N",
  DATS: "D", TIMS: "T",
  DEC: "P", CURR: "P", QUAN: "P",
  INT1: "b", INT2: "s", INT4: "I", INT8: "8",
  RAW: "X", LRAW: "X", LCHR: "X",
  STRG: "g", SSTR: "g",
  RSTR: "y", RAWSTRING: "y",
  FLTP: "F",
};

/** INTLEN from the type, per the rules in the module comment -- called only
 *  when DD03L leaves its own INTLEN blank. The INTTYPE is the ABAP letter
 *  (I for INT4, b/s for INT1/INT2, 8 for INT8), the DATATYPE the
 *  dictionary's own name; either is enough. */
function intlenOf(fieldname, datatype, inttype, digits) {
  if (["C", "N", "D", "T"].includes(inttype)) return pad(digits * 2);
  if (inttype === "I" || datatype === "INT4") return pad(4);
  if (inttype === "b" || datatype === "INT1") return pad(1);
  if (inttype === "s" || datatype === "INT2") return pad(2);
  if (inttype === "8" || datatype === "INT8") return pad(8);
  if (inttype === "X" && ["RAW", "LRAW", "LCHR"].includes(datatype)) return pad(digits);
  if (inttype === "P" || ["DEC", "CURR", "QUAN"].includes(datatype)) return pad(Math.ceil((digits + 1) / 2));
  if (inttype === "g" || ["STRG", "SSTR"].includes(datatype)) return pad(8);
  if (inttype === "y" || ["RSTR", "RAWSTRING"].includes(datatype)) return pad(8);
  if (inttype === "F" || datatype === "FLTP") return pad(8);
  throw new Error(`hana-ddic-map: ${fieldname}: ${datatype} (INTTYPE ${inttype || "?"}) has no INTLEN rule here`);
}

/** the fields of one DD03L read, in POSITION order. An .INCLUDE row is
 *  refused by name, with the structure it would have expanded, so the
 *  caller can splice those fields in themselves. */
export function ddicFields(rows, refs = {}) {
  const out = [];
  const includes = [];
  for (const row of [...(rows ?? [])].sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))) {
    const name = String(row.fieldname ?? "").toUpperCase();
    if (name.startsWith(".")) {
      includes.push(name === ".INCLUDE" ? String(row.precfield ?? "(no name)") : name);
      continue;
    }
    const field = ddicField(row, refs);
    if (field !== undefined) out.push(field);
  }
  if (includes.length > 0) {
    throw new Error(`hana-ddic-map: the table carries an include row (${includes.join(", ")}); read the included structure's DD03L and splice its fields in before mapping`);
  }
  return out;
}

/** what --mandt asks: is MANDT the first key field? A MANDT further back is
 *  not the client field ABAP's client handling assumes first. */
export function mandtFirstKey(fields) {
  const first = (fields ?? [])[0];
  return first !== undefined && first.fieldname === "MANDT" && first.key === true;
}

/** one mapped table as the tree's abapGit TABL XML, through the shared
 *  writer. `table` is {name, text, clidep, fields}, the fields as
 *  ddicFields returned them. */
export function tablXml(table) {
  const fields = (table.fields ?? []).map((f) => ({
    name: f.fieldname,
    dd03p: f.mandt === true ? f.tags : {
      ...(f.key ? {KEYFLAG: "X"} : {}),
      ...(f.rollname !== undefined ? {ROLLNAME: f.rollname, COMPTYPE: "E"} : {}),
      ADMINFIELD: "0",
      INTTYPE: f.inttype,
      INTLEN: f.intlen,
      ...(f.reftable !== undefined ? {REFTABLE: f.reftable} : {}),
      ...(f.precfield !== undefined ? {PRECFIELD: f.precfield} : {}),
      ...(f.reffield !== undefined ? {REFFIELD: f.reffield} : {}),
      ...(f.notnull ? {NOTNULL: "X"} : {}),
      DATATYPE: f.datatype,
      LENG: f.leng,
      ...(f.decimals !== undefined ? {DECIMALS: f.decimals} : {}),
      MASK: `  ${f.datatype}`,
    },
  }));
  return structureXml({name: table.name, label: table.text, clidep: table.clidep !== false, fields}, {transport: true});
}
