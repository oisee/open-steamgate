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
//   - INTLEN is derived, the way tools/segw-tables.mjs and
//     tools/dsl-l3-remote.mjs derive it: LENG x 2 for the character types
//     (C/N/D/T -- so DATS 16 and TIMS 12, as
//     src/webgui/zosd_revision_s.tabl.xml spells them), the byte count for
//     RAW/LRAW/LCHR, 1/2/4/8 for INT1/INT2/INT4/INT8, (LENG+1)/2 rounded up
//     for packed, 8 for the string/lob references (g/y) and FLTP. A type
//     with no rule here is refused by name, not guessed at -- the rule
//     hana-client's own TYPE_CODES table states.
//   - a field typed by a data element carries ROLLNAME and COMPTYPE E
//     beside its resolved types, which is what a system's own abapGit
//     export writes. An element with no type of its own resolves through
//     its domain (DD04L -> DD01L), the hop tools/adt-documents.mjs
//     documents and once missed.
//   - MANDT is the one field with a shape of its own, as segw-tables writes
//     it everywhere: KEYFLAG, ROLLNAME MANDT, ADMINFIELD 0, NOTNULL X,
//     COMPTYPE E, and nothing else.
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
  // the client field, in the shape this tree writes it everywhere
  if (fieldname === "MANDT") {
    return {fieldname, key, notnull: true, mandt: true,
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
  // the ABAP letters are case-significant: lower-case g is STRING, y is
  // XSTRING, b and s the small integers -- never folded
  const inttype = pick(row.inttype, element?.inttype, domain?.inttype);
  const digits = Number(pick(row.leng, element?.leng, domain?.leng) || 0);
  const decimals = Number(pick(row.decimals, element?.decimals, domain?.decimals) || 0);
  if (datatype === "") {
    throw new Error(`hana-ddic-map: ${fieldname} has no type of its own and its data element ${rollname === "" ? "(none named)" : rollname} resolves to nothing`);
  }
  return {
    fieldname, key, notnull, ...(rollname === "" ? {} : {rollname}),
    datatype, inttype, leng: pad(digits), intlen: intlenOf(fieldname, datatype, inttype, digits),
    ...(decimals > 0 ? {decimals: pad(decimals)} : {}),
  };
}

/** INTLEN from the type, per the rules in the module comment. DD03L's
 *  INTTYPE is the ABAP letter (I for INT4, b/s for INT1/INT2, 8 for INT8),
 *  the DATATYPE the dictionary's own name; either is enough. */
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
      includes.push(name === ".INCLUDE" ? String(row.prefield ?? "(no name)") : name);
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
      ...(f.notnull ? {NOTNULL: "X"} : {}),
      DATATYPE: f.datatype,
      LENG: f.leng,
      ...(f.decimals !== undefined ? {DECIMALS: f.decimals} : {}),
      MASK: `  ${f.datatype}`,
    },
  }));
  return structureXml({name: table.name, label: table.text, clidep: table.clidep !== false, fields}, {transport: true});
}
