// A dynamic Open SQL condition (`SELECT ... WHERE (lv_where)`) as an IR
// predicate: the string an ABAP program builds at run time, parsed against
// the columns of the table it reads, with every text or decimal value bound
// and every integer checked to its range. The one place its meaning is
// written.
//
// The transpiler pastes the string into the SQL text as it is, which is two
// defects at once: an ABAP condition is not the engine's dialect, and a
// literal is text in the statement rather than a bound value. Parsed here,
// both go: the tree is ordinary IR (col, lit, bin, not, like, inList,
// isNull), lowered by the same lower() as everything else, and the Go
// runtime ports this parser and checks it against the pairs this module
// writes (tools/ir-osql-where-pairs.mjs, test/fixtures/ir-pairs/).
//
// Every rule below was measured on A4H over SFLIGHT (docs/osql-where.md);
// what was not measured is refused by name (OsqlWhereError with a reason
// from REASONS), and the kernel's exception classes are named only where
// A4H raised them.
import {T, lit, bin, not, like, inList, isNull, col} from "./sqlscript-ir.mjs";

/** the reasons a refusal carries: a closed list, so a port can match them */
export const REASONS = Object.freeze([
  "host variable", "column to column", "qualified name", "number into char",
  "number format", "numc", "column type", "like type", "malformed", "too deep",
  "non-BMP",
]);

/** a condition this module does not carry, refused by name */
export class OsqlWhereError extends Error {
  constructor(message, reason) {
    super(message);
    if (!REASONS.includes(reason)) throw new Error(`OsqlWhereError: ${reason} is not in REASONS`);
    this.reason = reason;
  }
}
/** CX_SY_DYNAMIC_OSQL_SYNTAX on A4H: raised only for what was measured to raise it */
export class OsqlWhereSyntax extends Error {
  constructor(message) { super(message); this.abap = "CX_SY_DYNAMIC_OSQL_SYNTAX"; }
}
/** CX_SY_DYNAMIC_OSQL_SEMANTICS on A4H: raised only for what was measured to raise it */
export class OsqlWhereSemantics extends Error {
  constructor(message) { super(message); this.abap = "CX_SY_DYNAMIC_OSQL_SEMANTICS"; }
}
/** an uncatchable runtime error on A4H: nothing an ABAP program can CATCH */
export class OsqlWhereDump extends Error {}
/** CX_SY_OPEN_SQL_DATA_ERROR on A4H: a literal the column's type cannot
 *  take -- a RAW compared with anything but exactly its 2n hex digits in
 *  upper case (measured by the zvdb agent, 2026-09-24) */
export class OsqlWhereData extends Error {
  constructor(message) { super(message); this.abap = "CX_SY_OPEN_SQL_DATA_ERROR"; }
}

/** the outcome of a refused condition as the pairs file carries it, for a port to check */
export function errorCode(error) {
  if (error instanceof OsqlWhereSyntax || error instanceof OsqlWhereSemantics) {
    return {error: error.constructor.name, abap: error.abap};
  }
  if (error instanceof OsqlWhereDump) return {error: "OsqlWhereDump"};
  if (error instanceof OsqlWhereData) return {error: "OsqlWhereData", abap: error.abap};
  if (error instanceof OsqlWhereError) return {error: "Refused", reason: error.reason};
  throw error;
}

/** how deep a condition may nest, and how many comparisons it may hold:
 *  beyond these a recursive parser or lower() runs out of stack, and a port
 *  whose stack grows would answer differently, so both refuse here */
export const MAX_DEPTH = 256;
export const MAX_TERMS = 2000;

const upper = (v) => String(v ?? "").toUpperCase();
// only these separate tokens: a no-break space or any other Unicode blank is
// not one (`\s` would take them, and Go's RE2 would not)
const BLANK = new Set([" ", "\t", "\n", "\r"]);
const COMPARE = {"=": "=", "<>": "<>", "<": "<", ">": ">", "<=": "<=", ">=": ">=",
  EQ: "=", NE: "<>", LT: "<", GT: ">", LE: "<=", GE: ">="};
const KEYWORDS = new Set(["AND", "OR", "NOT", "BETWEEN", "LIKE", "ESCAPE", "IN", "IS", "NULL", "INITIAL",
  "EQ", "NE", "LT", "GT", "LE", "GE"]);
const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;

/** the string as tokens: {kind: "name" | "text" | "string" | "number" | "op" | "(" | ")" | ",", value, at} */
function tokens(text) {
  const out = [];
  let i = 0;
  const literal = (quote, kind) => {
    let value = "";
    let j = i + 1;
    for (;;) {
      if (j >= text.length) throw new OsqlWhereError(`an unterminated literal at ${i}`, "malformed");
      if (text[j] === quote) {
        if (text[j + 1] === quote) { value += quote; j += 2; continue; }
        break;
      }
      value += text[j];
      j += 1;
    }
    out.push({kind, value, at: i});
    i = j + 1;
  };
  while (i < text.length) {
    const ch = text[i];
    if (BLANK.has(ch)) { i += 1; continue; }
    if (ch === "'") { literal("'", "text"); continue; }
    // a backtick literal is a STRING (measured: carrid = `AA` finds AA)
    if (ch === "`") { literal("`", "string"); continue; }
    if (ch === "(" || ch === ")" || ch === ",") { out.push({kind: ch, value: ch, at: i}); i += 1; continue; }
    const op = /^(<>|<=|>=|=|<|>)/.exec(text.slice(i));
    if (op !== null) {
      // measured: `carrid='AA'` is CX_SY_DYNAMIC_OSQL_SYNTAX; an operator
      // stands between blanks
      const before = i === 0 || BLANK.has(text[i - 1]);
      const after = i + op[1].length >= text.length || BLANK.has(text[i + op[1].length]);
      if (!before && !after) throw new OsqlWhereSyntax(`the operator ${op[1]} at ${i} is not between blanks`);
      // a blank on one side only was not measured
      if (!before || !after) throw new OsqlWhereError(`the operator ${op[1]} at ${i} has a blank on one side only`, "malformed");
      out.push({kind: "op", value: op[1], at: i});
      i += op[1].length;
      continue;
    }
    // measured: `!=` is CX_SY_DYNAMIC_OSQL_SYNTAX
    if (ch === "!" && text[i + 1] === "=") throw new OsqlWhereSyntax(`!= at ${i} is not an Open SQL operator`);
    // measured: `@lv` in the condition of a statement without @ is
    // CX_SY_DYNAMIC_OSQL_SEMANTICS
    if (ch === "@") throw new OsqlWhereSemantics(`an escaped host variable at ${i} is not allowed in this statement`);
    const number = /^-?\d+(\.\d+)?/.exec(text.slice(i));
    if (number !== null) {
      // measured unquoted: 400 and -5; an unquoted decimal is not
      if (number[1] !== undefined) throw new OsqlWhereError(`the unquoted decimal ${number[0]} at ${i} is not measured`, "number format");
      out.push({kind: "number", value: number[0], at: i});
      i += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_\/][A-Za-z0-9_\/~]*/.exec(text.slice(i));
    if (name !== null) {
      // a word run straight into a literal or a parenthesis (EQ'LH',
      // IN('AA')) was not measured
      const next = text[i + name[0].length];
      if (next === "'" || next === "`" || next === "(") {
        throw new OsqlWhereError(`${name[0]} at ${i} runs into ${JSON.stringify(next)} without a blank`, "malformed");
      }
      out.push({kind: "name", value: name[0], at: i});
      i += name[0].length;
      continue;
    }
    throw new OsqlWhereError(`${JSON.stringify(ch)} at ${i} is not part of a condition this parser reads`, "malformed");
  }
  return out;
}

/**
 * ABAP's conversion of text to a number, as the kernel applied it to a
 * literal against an INT4 or packed column (measured): blanks around are
 * ignored, an empty text is 0, a sign may lead or trail ('385-' is -385),
 * the decimals are rounded half away from zero to the target's decimals
 * ('384.5' against INT4 is 385, '422.935' against P 2 is 422.94). A letter
 * ('abc', '1e3') and a value past the type ('99999999999' against INT4) are
 * uncatchable runtime errors. Returns the value as a decimal string with
 * exactly `decimals` digits after the point (none for 0).
 */
export function abapNumber(raw, decimals, column) {
  // blanks, not Unicode whitespace: what ABAP skips in a number is a space
  const text = String(raw).replace(/^ +| +$/g, "");
  if (text === "") return decimals === 0 ? "0" : `0.${"0".repeat(decimals)}`;
  // digits on both sides of a point, when there is one: '385.' and '.5' are
  // not measured
  const m = /^([+-]?)(\d+)(?:\.(\d+))?([+-]?)$/.exec(text);
  if (m === null || (m[1] !== "" && m[4] !== "")) {
    if (/[A-Za-z]/.test(text)) {
      throw new OsqlWhereDump(`${JSON.stringify(raw)} against the numeric column ${column} is not a number: an uncatchable runtime error on A4H`);
    }
    throw new OsqlWhereError(`${JSON.stringify(raw)} against the numeric column ${column}: this number format is not measured`, "number format");
  }
  const negative = (m[1] || m[4]) === "-";
  const whole = (m[2] || "0").replace(/^0+(?=\d)/, "");
  const fraction = m[3] ?? "";
  // round half away from zero to `decimals` places, on the digits
  let digits = whole + fraction.padEnd(decimals, "0").slice(0, decimals);
  if ((fraction[decimals] ?? "0") >= "5") {
    const carried = (BigInt(digits) + 1n).toString();
    digits = carried.padStart(digits.length, "0");
  }
  digits = digits.replace(/^0+(?=\d)/, "") || "0";
  const intPart = decimals === 0 ? digits : (digits.slice(0, -decimals) || "0");
  const decPart = decimals === 0 ? "" : digits.padStart(decimals + 1, "0").slice(-decimals);
  const zero = /^0*$/.test(digits);
  return `${negative && !zero ? "-" : ""}${intPart}${decimals === 0 ? "" : `.${decPart}`}`;
}

/** a literal as a value of the column's type, the conversion A4H does */
function valueFor(token, column) {
  const {type, kind} = column;
  const raw = token.value;
  if (/[\uD800-\uDFFF]/.test(raw)) {
    throw new OsqlWhereError(`a character outside the Basic Multilingual Plane in a literal against ${column.name} is not carried`, "non-BMP");
  }
  if (type.abap === "X") {
    // measured on A4H (the zvdb agent): in a dynamic WHERE a RAW(n) takes
    // exactly 2n hex digits in upper case; '12', lower case, a blank before
    // or after, '' or an unquoted number is CX_SY_OPEN_SQL_DATA_ERROR.
    // RAWSTRING was not measured
    if (!Number.isInteger(type.len)) throw new OsqlWhereError(`a condition on the RAWSTRING column ${column.name} is not measured`, "column type");
    if (token.kind === "number" || !new RegExp(`^[0-9A-F]{${2 * type.len}}$`).test(raw)) {
      throw new OsqlWhereData(`${JSON.stringify(raw)} against the RAW(${type.len}) column ${column.name}: only its ${2 * type.len} hex digits in upper case`);
    }
    return lit(raw, type);
  }
  if (type.abap === "I") {
    const value = abapNumber(raw, 0, column.name);
    const n = Number(value);
    if (n < INT4_MIN || n > INT4_MAX || !Number.isSafeInteger(n)) {
      throw new OsqlWhereDump(`${JSON.stringify(raw)} is past the INT4 range of ${column.name}: an uncatchable runtime error on A4H`);
    }
    return lit(n, type);
  }
  if (type.abap === "P") {
    const dec = Number.isInteger(type.dec) ? type.dec : 0;
    const value = abapNumber(raw, dec, column.name);
    // `len` is the DDIC length in digits, as everywhere in the IR (T.dec(15, 2)
    // is CURR 15,2, eight bytes on the database); a value with more digits
    // is an overflow, uncatchable as it was for INT4
    const room = Number.isInteger(type.len) ? type.len : 31;
    if (value.replace(/[-.]/g, "").replace(/^0+(?=\d)/, "").length > room) {
      throw new OsqlWhereDump(`${JSON.stringify(raw)} is past the ${room} digits of ${column.name}: an overflow, uncatchable on A4H as it was for INT4`);
    }
    // a decimal string, bound: never a JavaScript number, whose text differs
    // from Go's and loses digits past 15
    return lit(value, type);
  }
  if (token.kind === "number" && type.abap !== "C") {
    throw new OsqlWhereError(`an unquoted number against the ${type.abap} column ${column.name} is not measured`, "number into char");
  }
  if (type.abap === "C" && kind === "NUMC") {
    const digits = raw.replace(/^ +| +$/g, "");
    if (!/^\d+$/.test(digits) || digits.length > type.len) {
      throw new OsqlWhereError(`${JSON.stringify(raw)} against the NUMC column ${column.name}: only digits within its length are measured`, "numc");
    }
    return lit(digits.padStart(type.len, "0"), type);
  }
  if (type.abap === "C" || type.abap === "D") {
    if (token.kind === "number") {
      throw new OsqlWhereError(`an unquoted number against the column ${column.name} is not measured`, "number into char");
    }
    // cut to the column's length (UTF-16 code units, as the kernel counts),
    // then its trailing blanks gone: 'LH X' against CHAR3 is 'LH', and
    // '20161115000000' against DATS is '20161115' (both measured)
    const len = type.abap === "D" ? 8 : type.len;
    const ctype = type.abap === "D" ? T.char(8) : type;
    return lit(raw.slice(0, len).replace(/ +$/, ""), ctype);
  }
  if (type.abap === "STRING") {
    if (token.kind === "string") return lit(raw, type);
    // a quoted literal is type C, and C into STRING drops trailing blanks
    // (ABAP's conversion rule; not measured in a WHERE, SFLIGHT has no STRING)
    return lit(raw.replace(/ +$/, ""), type);
  }
  throw new OsqlWhereError(`a condition on the ${type.abap} column ${column.name} is not carried yet`, "column type");
}

/**
 * `WHERE (text)` as an IR predicate over the columns given.
 * @param text     the condition as ABAP built it
 * @param columns  {NAME: {type, kind?}}: the table's columns as IR types
 *                 (C with len, I, P with len/dec, STRING, D), kind "NUMC"
 *                 for a NUMC column
 * @returns an IR predicate, or undefined when the string is empty (every row)
 */
export function osqlWherePredicate(text, columns) {
  const known = new Map(Object.entries(columns ?? {}).map(([name, one]) => [upper(name), {name: upper(name), ...one}]));
  const list = tokens(String(text ?? ""));
  if (list.length === 0) return undefined;
  let at = 0;
  let depth = 0;
  let terms = 0;
  const peek = (offset = 0) => list[at + offset];
  const word = (offset = 0) => (peek(offset)?.kind === "name" ? upper(peek(offset).value) : undefined);
  const take = () => list[at++];
  const deeper = () => {
    depth += 1;
    if (depth > MAX_DEPTH) throw new OsqlWhereError(`the condition nests deeper than ${MAX_DEPTH}`, "too deep");
  };
  const malformed = (message) => new OsqlWhereError(message, "malformed");
  const expect = (kind, value) => {
    const one = take();
    if (one === undefined || one.kind !== kind || (value !== undefined && upper(one.value) !== value)) {
      throw malformed(`expected ${value ?? kind} ${one === undefined ? "at the end" : `at ${one.at}, found ${JSON.stringify(one.value)}`}`);
    }
    return one;
  };
  const literal = (column) => {
    const one = take();
    // measured: `carrid = ` with nothing after is CX_SY_DYNAMIC_OSQL_SYNTAX
    if (one === undefined) throw new OsqlWhereSyntax("a value is missing at the end");
    if (one.kind === "text" || one.kind === "string" || one.kind === "number") return valueFor(one, column);
    if (one.kind === "name" && !KEYWORDS.has(upper(one.value))) {
      if (known.has(upper(one.value))) throw new OsqlWhereError(`comparing the column ${column.name} with the column ${upper(one.value)} is not carried yet`, "column to column");
      // measured: a system reads `carrid = lv_c`; no producer here writes one
      throw new OsqlWhereError(`${one.value} is a host variable in the condition, which is not carried (no producer here writes one)`, "host variable");
    }
    throw malformed(`a value was expected at ${one.at}, found ${JSON.stringify(one.value)}`);
  };

  // a chain of AND / OR becomes a BALANCED tree, split in the middle: the
  // meaning is the same (both are associative) and the depth is log2 of the
  // chain, where a left-deep tree was as deep as the chain -- past SQLite's
  // expression depth of 1000 at 1000 terms, and one recursion of lower()
  // per term
  const balanced = (op, parts) => (parts.length === 1 ? parts[0]
    : bin(op, balanced(op, parts.slice(0, Math.ceil(parts.length / 2))),
      balanced(op, parts.slice(Math.ceil(parts.length / 2))), T.bool));
  const orExpr = () => {
    const parts = [andExpr()];
    while (word() === "OR") { take(); parts.push(andExpr()); }
    return balanced("OR", parts);
  };
  const andExpr = () => {
    const parts = [notExpr()];
    while (word() === "AND") { take(); parts.push(notExpr()); }
    return balanced("AND", parts);
  };
  const notExpr = () => {
    if (word() === "NOT") {
      take();
      deeper();
      const inner = notExpr();
      depth -= 1;
      return not(inner);
    }
    return primary();
  };
  const primary = () => {
    const first = peek();
    if (first === undefined) throw malformed("a condition is missing at the end");
    if (first.kind === "(") {
      take();
      deeper();
      const inner = orExpr();
      depth -= 1;
      expect(")");
      return inner;
    }
    if (first.kind === "text" || first.kind === "string" || first.kind === "number") {
      // measured: `1 = 1` is CX_SY_DYNAMIC_OSQL_SEMANTICS on A4H
      throw new OsqlWhereSemantics(`a literal on the left of a condition (${JSON.stringify(first.value)} at ${first.at}) is not a column`);
    }
    if (first.kind !== "name" || KEYWORDS.has(upper(first.value))) {
      throw malformed(`a column was expected at ${first.at}, found ${JSON.stringify(first.value)}`);
    }
    take();
    terms += 1;
    if (terms > MAX_TERMS) throw new OsqlWhereError(`the condition holds more than ${MAX_TERMS} comparisons`, "too deep");
    if (first.value.includes("~")) throw new OsqlWhereError(`the qualified name ${first.value} is not carried yet`, "qualified name");
    const column = known.get(upper(first.value));
    // measured: an unknown column is CX_SY_DYNAMIC_OSQL_SEMANTICS
    if (column === undefined) throw new OsqlWhereSemantics(`${upper(first.value)} is not a column of the table`);
    const expr = col(column.name, column.type.abap === "D" ? T.char(8) : column.type);
    const op = peek();
    if (op === undefined) throw malformed(`${column.name} is followed by nothing`);
    if (op.kind === "op" || (op.kind === "name" && COMPARE[upper(op.value)] !== undefined)) {
      take();
      return bin(COMPARE[op.kind === "op" ? op.value : upper(op.value)], expr, literal(column), T.bool);
    }
    const negated = word() === "NOT";
    if (negated) take();
    const keyword = word();
    // BETWEEN and IN on a RAW were not measured
    if ((keyword === "BETWEEN" || keyword === "IN") && column.type.abap === "X") {
      throw new OsqlWhereError(`${keyword} on the RAW column ${column.name} is not measured`, "column type");
    }
    if (keyword === "BETWEEN") {
      take();
      const low = literal(column);
      expect("name", "AND");
      const high = literal(column);
      const between = bin("AND", bin(">=", expr, low, T.bool), bin("<=", expr, high, T.bool), T.bool);
      return negated ? not(between) : between;
    }
    if (keyword === "LIKE") {
      take();
      const pattern = take();
      if (pattern?.kind !== "text") throw malformed(`LIKE wants a quoted pattern after ${column.name}`);
      if (column.type.abap !== "C" || column.kind === "NUMC") {
        throw new OsqlWhereError(`LIKE on the column ${column.name} is not measured`, "like type");
      }
      if (/[\uD800-\uDFFF]/.test(pattern.value)) throw new OsqlWhereError("a non-BMP character in a LIKE pattern is not carried", "non-BMP");
      let escape;
      if (word() === "ESCAPE") {
        take();
        const e = take();
        if (e?.kind !== "text" || e.value.length !== 1) throw malformed("ESCAPE wants one quoted character");
        // measured: ESCAPE '%' is CX_SY_DYNAMIC_OSQL_SEMANTICS
        if (e.value === "%" || e.value === "_") throw new OsqlWhereSemantics(`ESCAPE ${JSON.stringify(e.value)} is a wildcard`);
        escape = lit(e.value, T.str);
      }
      // measured: LIKE 'AA ' finds what LIKE 'AA' finds on a CHAR column --
      // without an ESCAPE; with one, a trailing blank could be the escaped
      // character, and that was not measured
      if (escape !== undefined && / $/.test(pattern.value)) {
        throw new OsqlWhereError("a LIKE pattern with an ESCAPE and a trailing blank is not measured", "like type");
      }
      return like(expr, lit(pattern.value.replace(/ +$/, ""), T.str), escape, negated);
    }
    if (keyword === "IN") {
      take();
      expect("(");
      const values = [literal(column)];
      while (peek()?.kind === ",") { take(); values.push(literal(column)); }
      expect(")");
      return inList(expr, values, negated);
    }
    if (!negated && keyword === "IS") {
      take();
      const isNot = word() === "NOT";
      if (isNot) take();
      // measured: IS INITIAL is CX_SY_DYNAMIC_OSQL_SEMANTICS on A4H; IS NOT
      // INITIAL was not measured
      if (word() === "INITIAL") {
        if (isNot) throw new OsqlWhereError("IS NOT INITIAL is not measured", "malformed");
        throw new OsqlWhereSemantics("IS INITIAL is not allowed in a dynamic condition here");
      }
      expect("name", "NULL");
      return isNot ? not(isNull(expr)) : isNull(expr);
    }
    throw malformed(`${column.name} is followed by ${JSON.stringify(op.value)} at ${op.at}, which is not a comparison`);
  };

  const pred = orExpr();
  if (at < list.length) throw malformed(`${JSON.stringify(peek().value)} at ${peek().at} is left over after the condition`);
  return pred;
}
