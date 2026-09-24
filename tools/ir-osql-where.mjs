// A dynamic Open SQL condition (`SELECT ... WHERE (lv_where)`) as an IR
// predicate: the string an ABAP program builds at run time, parsed against
// the columns of the table it reads, with every literal bound as a value of
// the column's type. The one place its meaning is written.
//
// The transpiler pastes the string into the SQL text as it is, which is two
// defects at once: an ABAP condition is not the engine's dialect, and a
// literal is text in the statement rather than a bound value. Parsed here,
// both go: the tree is ordinary IR (col, lit, bin, not, like, inList,
// isNull), lowered by the same lower() as everything else, and the Go
// runtime ports this parser and checks it against the pairs this module
// writes (tools/ir-osql-where-pairs.mjs, test/fixtures/ir-pairs/).
//
// What the kernel does with such a string, measured on A4H on SFLIGHT
// (2026-09-24, docs/osql-where.md), and what this parser therefore does:
//   - an empty or blank string is no condition: every row;
//   - AND binds tighter than OR, NOT tighter than AND, and NOT applies to
//     the one condition after it without parentheses;
//   - = <> < > <= >= and EQ NE LT GT LE GE compare; `!=` is a syntax error;
//   - [NOT] BETWEEN a AND b, [NOT] LIKE p [ESCAPE e], [NOT] IN (a, b),
//     IS [NOT] NULL;
//   - a column name is case-insensitive; a literal is case-sensitive, LIKE
//     included ('l%' finds nothing where 'L%' finds LH);
//   - a literal is converted to the column's type: a CHAR literal is cut to
//     the column's length ('LH X' against CHAR3 finds LH), a NUMC one is
//     zero-padded ('400' finds '0400'), a quoted number against an INT4
//     column is that number ('385' = 385); text that is not a number
//     against an INT4 column is an uncatchable runtime error;
//   - an unknown column, or a literal on the left (`1 = 1`), is
//     CX_SY_DYNAMIC_OSQL_SEMANTICS; a malformed condition is
//     CX_SY_DYNAMIC_OSQL_SYNTAX.
// Not carried, refused by name: a host variable in the string (`carrid =
// lv_c` works on a system, and no producer here writes one), comparing two
// columns, a qualified name (`tab~col`), and any literal conversion that was
// not measured.
import {T, lit, bin, not, like, inList, isNull, col} from "./sqlscript-ir.mjs";

/** a condition this module does not carry, refused by name */
export class OsqlWhereError extends Error {
  constructor(message, reason = "refused") { super(message); this.reason = reason; }
}
/** CX_SY_DYNAMIC_OSQL_SYNTAX on A4H */
export class OsqlWhereSyntax extends OsqlWhereError {
  constructor(message) { super(message, "syntax"); this.abap = "CX_SY_DYNAMIC_OSQL_SYNTAX"; }
}
/** CX_SY_DYNAMIC_OSQL_SEMANTICS on A4H */
export class OsqlWhereSemantics extends OsqlWhereError {
  constructor(message) { super(message, "semantics"); this.abap = "CX_SY_DYNAMIC_OSQL_SEMANTICS"; }
}
/** an uncatchable runtime error on A4H: nothing an ABAP program can CATCH */
export class OsqlWhereDump extends OsqlWhereError {
  constructor(message) { super(message, "dump"); }
}

/** the outcome of a refused condition as the pairs file carries it, for a port to check */
export function errorCode(error) {
  if (error instanceof OsqlWhereSyntax || error instanceof OsqlWhereSemantics) {
    return {error: error.constructor.name, abap: error.abap};
  }
  if (error instanceof OsqlWhereDump) return {error: "OsqlWhereDump"};
  if (error instanceof OsqlWhereError) return {error: "Refused", reason: error.reason};
  throw error;
}

const upper = (v) => String(v ?? "").toUpperCase();
const COMPARE = {"=": "=", "<>": "<>", "<": "<", ">": ">", "<=": "<=", ">=": ">=",
  EQ: "=", NE: "<>", LT: "<", GT: ">", LE: "<=", GE: ">="};
const KEYWORDS = new Set(["AND", "OR", "NOT", "BETWEEN", "LIKE", "ESCAPE", "IN", "IS", "NULL",
  "EQ", "NE", "LT", "GT", "LE", "GE"]);

/** the string as tokens: {kind: "name" | "text" | "number" | "op" | "(" | ")" | ",", value} */
function tokens(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === "'") {
      let value = "";
      let j = i + 1;
      for (;;) {
        if (j >= text.length) throw new OsqlWhereSyntax(`an unterminated literal at ${i}`);
        if (text[j] === "'") {
          if (text[j + 1] === "'") { value += "'"; j += 2; continue; }
          break;
        }
        value += text[j];
        j += 1;
      }
      out.push({kind: "text", value, at: i});
      i = j + 1;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === ",") { out.push({kind: ch, value: ch, at: i}); i += 1; continue; }
    const op = /^(<>|<=|>=|=|<|>)/.exec(text.slice(i));
    if (op !== null) { out.push({kind: "op", value: op[1], at: i}); i += op[1].length; continue; }
    const number = /^\d+(\.\d+)?/.exec(text.slice(i));
    if (number !== null) { out.push({kind: "number", value: number[0], at: i}); i += number[0].length; continue; }
    const name = /^[A-Za-z_\/][A-Za-z0-9_\/~@-]*/.exec(text.slice(i));
    if (name !== null) { out.push({kind: "name", value: name[0], at: i}); i += name[0].length; continue; }
    // `!=` among them: a syntax error on A4H
    throw new OsqlWhereSyntax(`${JSON.stringify(ch)} at ${i} is not part of an Open SQL condition`);
  }
  return out;
}

/** a literal as a value of the column's type, the conversion A4H does */
function valueFor(token, column) {
  const {type, kind} = column;
  const raw = token.value;
  if (type.abap === "I") {
    if (!/^\s*-?\d+\s*$/.test(raw)) {
      throw new OsqlWhereDump(`${JSON.stringify(raw)} against the INTEGER column ${column.name} is not a number: an uncatchable runtime error on A4H`);
    }
    return lit(Number(raw), type);
  }
  if (type.abap === "P") {
    if (!/^\s*-?\d+(\.\d+)?\s*$/.test(raw)) {
      throw new OsqlWhereDump(`${JSON.stringify(raw)} against the packed column ${column.name} is not a number: an uncatchable runtime error on A4H`);
    }
    return lit(Number(raw), type);
  }
  if (type.abap === "C" && kind === "NUMC") {
    const digits = raw.trim();
    if (!/^\d+$/.test(digits) || digits.length > type.len) {
      throw new OsqlWhereError(`${JSON.stringify(raw)} against the NUMC column ${column.name}: only digits within its length are measured`, "numc");
    }
    return lit(digits.padStart(type.len, "0"), type);
  }
  if (type.abap === "C") {
    if (token.kind === "number") {
      throw new OsqlWhereError(`an unquoted number against the CHAR column ${column.name} is not measured`, "number into char");
    }
    // cut to the column's length, then its trailing blanks gone, as ABAP
    // converts a literal to CHAR n ('LH X' against CHAR3 is 'LH')
    return lit(raw.slice(0, type.len).replace(/ +$/, ""), type);
  }
  if (type.abap === "STRING") {
    if (token.kind === "number") throw new OsqlWhereError(`an unquoted number against the STRING column ${column.name} is not measured`, "number into string");
    return lit(raw, type);
  }
  throw new OsqlWhereError(`a condition on the ${type.abap} column ${column.name} is not carried yet`, "column type");
}

/**
 * `WHERE (text)` as an IR predicate over the columns given.
 * @param text     the condition as ABAP built it
 * @param columns  {NAME: {type, kind?}}: the table's columns, IR types, kind
 *                 "NUMC" for a NUMC column
 * @returns an IR predicate, or undefined when the string is empty (every row)
 */
export function osqlWherePredicate(text, columns) {
  const known = new Map(Object.entries(columns ?? {}).map(([name, one]) => [upper(name), {name: upper(name), ...one}]));
  const list = tokens(String(text ?? ""));
  if (list.length === 0) return undefined;
  let at = 0;
  const peek = (offset = 0) => list[at + offset];
  const word = (offset = 0) => (peek(offset)?.kind === "name" ? upper(peek(offset).value) : undefined);
  const take = () => list[at++];
  const expect = (kind, value) => {
    const one = take();
    if (one === undefined || one.kind !== kind || (value !== undefined && upper(one.value) !== value)) {
      throw new OsqlWhereSyntax(`expected ${value ?? kind} ${one === undefined ? "at the end" : `at ${one.at}, found ${JSON.stringify(one.value)}`}`);
    }
    return one;
  };
  const literal = (column) => {
    const one = take();
    if (one === undefined) throw new OsqlWhereSyntax("a value is missing at the end");
    if (one.kind === "text" || one.kind === "number") return valueFor(one, column);
    if (one.kind === "name" && !KEYWORDS.has(upper(one.value))) {
      if (known.has(upper(one.value))) throw new OsqlWhereError(`comparing the column ${column.name} with the column ${upper(one.value)} is not carried yet`, "column to column");
      throw new OsqlWhereError(`${one.value} is a host variable in the condition, which is not carried (no producer here writes one)`, "host variable");
    }
    throw new OsqlWhereSyntax(`a value was expected at ${one.at}, found ${JSON.stringify(one.value)}`);
  };

  const orExpr = () => {
    let left = andExpr();
    while (word() === "OR") { take(); left = bin("OR", left, andExpr(), T.bool); }
    return left;
  };
  const andExpr = () => {
    let left = notExpr();
    while (word() === "AND") { take(); left = bin("AND", left, notExpr(), T.bool); }
    return left;
  };
  const notExpr = () => {
    if (word() === "NOT") { take(); return not(notExpr()); }
    return primary();
  };
  const primary = () => {
    const first = peek();
    if (first === undefined) throw new OsqlWhereSyntax("a condition is missing at the end");
    if (first.kind === "(") {
      take();
      const inner = orExpr();
      expect(")");
      return inner;
    }
    if (first.kind === "text" || first.kind === "number") {
      // measured: `1 = 1` is CX_SY_DYNAMIC_OSQL_SEMANTICS on A4H
      throw new OsqlWhereSemantics(`a literal on the left of a condition (${JSON.stringify(first.value)} at ${first.at}) is not a column`);
    }
    if (first.kind !== "name" || KEYWORDS.has(upper(first.value))) {
      throw new OsqlWhereSyntax(`a column was expected at ${first.at}, found ${JSON.stringify(first.value)}`);
    }
    take();
    if (first.value.includes("~")) throw new OsqlWhereError(`the qualified name ${first.value} is not carried yet`, "qualified name");
    const column = known.get(upper(first.value));
    if (column === undefined) throw new OsqlWhereSemantics(`${upper(first.value)} is not a column of the table`);
    const expr = col(column.name, column.type);
    const op = peek();
    if (op === undefined) throw new OsqlWhereSyntax(`${column.name} is followed by nothing`);
    if (op.kind === "op" || (op.kind === "name" && COMPARE[upper(op.value)] !== undefined)) {
      take();
      return bin(COMPARE[op.kind === "op" ? op.value : upper(op.value)], expr, literal(column), T.bool);
    }
    const negated = word() === "NOT";
    if (negated) take();
    const keyword = word();
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
      if (pattern?.kind !== "text") throw new OsqlWhereSyntax(`LIKE wants a quoted pattern after ${column.name}`);
      if (!["C", "STRING"].includes(column.type.abap)) throw new OsqlWhereError(`LIKE on the ${column.type.abap} column ${column.name} is not carried`, "like type");
      let escape;
      if (word() === "ESCAPE") {
        take();
        const e = take();
        if (e?.kind !== "text" || e.value.length !== 1) throw new OsqlWhereSyntax("ESCAPE wants one quoted character");
        escape = lit(e.value, T.str);
      }
      return like(expr, lit(pattern.value, T.str), escape, negated);
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
      expect("name", "NULL");
      return isNot ? not(isNull(expr)) : isNull(expr);
    }
    throw new OsqlWhereSyntax(`${column.name} is followed by ${JSON.stringify(op.value)} at ${op.at}, which is not a comparison`);
  };

  const pred = orExpr();
  if (at < list.length) throw new OsqlWhereSyntax(`${JSON.stringify(peek().value)} at ${peek().at} is left over after the condition`);
  return pred;
}
