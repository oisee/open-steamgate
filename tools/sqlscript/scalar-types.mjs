// ABAP scalar types into the IR's, in one place.
//
// Three callers used to spell this separately: the procedure compiler read
// the literal forms of a method signature (`I`, `STRING`, `C LENGTH 10`),
// the DDIC catalogue read a table field's DATATYPE/LENG/DECIMALS, and the
// coverage instrument read nothing at all -- it handed the binder no scalar
// types, so every `:p_clnt` in the corpus counted as "unknown scalar", and a
// number that was a property of the instrument sat at the top of the
// histogram (foreman-dell, 2026-09-22).
//
// A scalar's ABAP type is one of three things, tried in this order:
//   1. a literal:  I, STRING, D, T, C LENGTH n / CHARn, P LENGTH n DECIMALS m
//   2. a CDS built-in, as a DDLS spells it:  abap.clnt, abap.char(10),
//      abap.dec(15,2), abap.int4 ...
//   3. a data element, resolved by whoever holds a dictionary: `resolve(name)`
//      answers {DATATYPE, LENG, DECIMALS} or undefined.
// Anything else is a named refusal, never STRING by default: a client field
// read as text would compare and pad differently on every dialect, and the
// body would run and answer something else.
import {T} from "../sqlscript-ir.mjs";

export class UnresolvedScalarType extends Error {
  constructor(message) {
    super(message);
    this.code = "UNRESOLVED_SCALAR_TYPE";
  }
}

const upper = (value) => String(value ?? "").toUpperCase().trim();

/** DDIC DATATYPE/LENG/DECIMALS into an IR type; `what` names the owner for the error */
export function irTypeOfDdic({DATATYPE, LENG, DECIMALS}, what = "a DDIC type") {
  const datatype = upper(DATATYPE);
  const length = Number(LENG ?? 0);
  const decimals = Number(DECIMALS ?? 0);
  if (["CHAR", "CLNT", "CUKY", "LANG", "UNIT", "ACCP", "NUMC", "DATS", "TIMS", "LCHR"].includes(datatype)) {
    return T.char(length);
  }
  if (["INT1", "INT2", "INT4"].includes(datatype)) return T.int;
  if (datatype === "INT8") return T.int8;
  if (["DEC", "CURR", "QUAN", "DF16_DEC", "DF34_DEC"].includes(datatype)) return T.dec(length, decimals);
  if (["STRG", "SSTR"].includes(datatype)) return T.str;
  if (["RAW", "LRAW", "RSTR"].includes(datatype)) return T.bytes(length || undefined);
  throw new UnresolvedScalarType(`${what}: datatype ${datatype || "<unresolved>"} has no portable IR type`);
}

// the CDS spellings of the built-ins, `abap.xxx( len, dec )`
const CDS_BUILTIN = {
  CLNT: () => T.char(3), LANG: () => T.char(1), DATS: () => T.char(8), TIMS: () => T.char(6),
  CHAR: (n) => T.char(n), NUMC: (n) => T.char(n), CUKY: () => T.char(5), UNIT: (n) => T.char(n ?? 3),
  ACCP: () => T.char(6), INT1: () => T.int, INT2: () => T.int, INT4: () => T.int, INT8: () => T.int8,
  DEC: (n, d) => T.dec(n, d ?? 0), CURR: (n, d) => T.dec(n, d ?? 0), QUAN: (n, d) => T.dec(n, d ?? 0),
  STRING: () => T.str, SSTRING: () => T.str, RAW: (n) => T.bytes(n), RAWSTRING: () => T.bytes(),
};

/**
 * One ABAP type text into an IR type, or a named refusal.
 *
 * `resolve(name)` is how a dictionary joins in; without one, only the
 * literal and CDS built-in forms are known and a data element is refused
 * with its name, so the histogram can say which dictionary is missing.
 */
export function scalarTypeOf(abapType, resolve = () => undefined) {
  const text = upper(abapType);
  if (text === "") throw new UnresolvedScalarType("a scalar with no ABAP type at all");
  if (["I", "INT4", "INTEGER"].includes(text)) return T.int;
  if (["INT8"].includes(text)) return T.int8;
  if (["STRING", "SSTRING"].includes(text)) return T.str;
  if (["D", "DATS"].includes(text)) return T.char(8);
  if (["T", "TIMS"].includes(text)) return T.char(6);
  if (["XSTRING"].includes(text)) return T.bytes();
  const length = /^(?:C\s+LENGTH\s+|CHAR|N\s+LENGTH\s+|NUMC)(\d+)$/.exec(text)?.[1];
  if (length !== undefined) return T.char(Number(length));
  const raw = /^(?:X\s+LENGTH\s+|RAW)(\d+)$/.exec(text)?.[1];
  if (raw !== undefined) return T.bytes(Number(raw));
  const packed = /^P(?:\s+LENGTH\s+(\d+))?(?:\s+DECIMALS\s+(\d+))?$/.exec(text);
  if (packed !== null) return T.dec(Number(packed[1] ?? 16), Number(packed[2] ?? 2));
  const cds = /^ABAP\.(\w+)(?:\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?$/.exec(text);
  if (cds !== null) {
    const make = CDS_BUILTIN[cds[1]];
    if (make === undefined) throw new UnresolvedScalarType(`CDS built-in ${abapType} has no portable IR type`);
    return make(cds[2] === undefined ? undefined : Number(cds[2]), cds[3] === undefined ? undefined : Number(cds[3]));
  }
  if (/^[A-Z_\/][\w\/]*$/.test(text)) {
    const found = resolve(text);
    if (found !== undefined && found.DATATYPE !== undefined && found.DATATYPE !== "") {
      return irTypeOfDdic(found, `data element ${text}`);
    }
    throw new UnresolvedScalarType(`data element ${text} is not in any dictionary this run was given`);
  }
  throw new UnresolvedScalarType(`ABAP type ${abapType} has no portable SQLScript mapping`);
}

/** the signature's guess at which parameters are tables: the binder's rule, kept in one place */
export function isTableParameter(p) {
  return /^(tt_|.*_tab$|.*TABLE.*)/i.test(String(p.abapType ?? "")) || /^(it|et|ct)_/i.test(String(p.name ?? ""));
}

/**
 * The scalar IN parameters of a signature, typed.
 *
 * Returns both halves rather than throwing: a body that never mentions an
 * unresolvable parameter is not refused for it, and one that does is refused
 * by the binder with the reason recorded here.
 */
export function signatureScalars(signature, resolve) {
  const types = {};
  const unresolved = {};
  for (const p of signature?.parameters ?? []) {
    if (!["IN", "INOUT"].includes(p.direction ?? "IN") || isTableParameter(p)) continue;
    const name = upper(p.name);
    try {
      types[name] = scalarTypeOf(p.abapType, resolve);
    } catch (error) {
      if (!(error instanceof UnresolvedScalarType)) throw error;
      unresolved[name] = error.message;
    }
  }
  return {types, unresolved};
}
