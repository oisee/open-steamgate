// ABAP ranges (`col IN rt_range`, a SELECT-OPTIONS table of SIGN / OPTION /
// LOW / HIGH) as an IR condition: the one place their meaning is written.
//
// The ranges' rows are values known only at run time, like a scalar input.
// Two uses, one semantics:
//   - a JS host expands them into IR with rangesPredicate() and lowers the
//     whole statement;
//   - a host that runs no JS at request time (the Go runtime) lowers the
//     static statement at build time with a hostPred() where the ranges go,
//     and fills that placeholder with its port of rangesPredicate(), checked
//     byte for byte against the pairs this module writes
//     (tools/ir-ranges-pairs.mjs, test/fixtures/ir-pairs/).
//
// The rules, as ABAP Open SQL has them:
//   - no rows: no restriction (true);
//   - otherwise (any I row matches, true when there is none) AND NOT (any E
//     row matches);
//   - EQ NE GT GE LT LE compare; BT is LOW <= x <= HIGH; NB is its negation;
//   - CP / NP are LIKE / NOT LIKE with the pattern translated: `*` any
//     string, `+` one character, `#` makes the next character literal; `%`
//     and `_` are ordinary characters in ABAP and are escaped for LIKE; the
//     escape character is `#`, as ABAP's own is;
//   - LOW / HIGH are bound as the column binds (measured on A4H,
//     docs/sqlscript-hana-observed.md): a CHAR value right-trimmed, a NUMC
//     one zero-padded to its length, an INTEGER as a number.
import {T, lit, bin, not, like, col, filter, scan} from "./sqlscript-ir.mjs";
import {lower} from "./sqlscript-lower.mjs";

export class RangesError extends Error {}

const upper = (v) => String(v ?? "").toUpperCase();
const TRUE = () => bin("=", lit(1, T.int), lit(1, T.int), T.bool);
const or = (parts) => parts.reduce((a, b) => bin("OR", a, b, T.bool));
const and = (a, b) => bin("AND", a, b, T.bool);

/** a LOW / HIGH value as the column's type binds it */
function bound(value, type, kind) {
  if (type?.abap === "I") {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new RangesError(`range value ${JSON.stringify(value)} is not an INTEGER`);
    return lit(n, T.int);
  }
  if (type?.abap === "C") {
    let text = String(value ?? "").replace(/ +$/, "");
    if (kind === "NUMC") {
      if (!/^\d*$/.test(text)) throw new RangesError(`range value ${JSON.stringify(value)} is not NUMC digits`);
      text = text.padStart(type.len, "0");
    }
    if (Number.isInteger(type.len) && text.length > type.len) {
      throw new RangesError(`range value ${JSON.stringify(value)} is longer than the column's ${type.len} characters`);
    }
    return lit(text, type);
  }
  if (type?.abap === "STRING") return lit(String(value ?? ""), type);
  throw new RangesError(`ranges over a column of type ${type?.abap ?? "unknown"} are not carried yet`);
}

/** an ABAP CP pattern as a LIKE pattern with `#` as its escape character */
export function likePattern(pattern) {
  let out = "";
  const text = String(pattern ?? "");
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "#") {
      const next = text[i + 1];
      if (next === undefined) throw new RangesError(`CP pattern ${JSON.stringify(pattern)} ends in the escape character #`);
      out += ["%", "_", "#"].includes(next) ? `#${next}` : next;
      i += 1;
    } else if (ch === "*") out += "%";
    else if (ch === "+") out += "_";
    else if (ch === "%" || ch === "_") out += `#${ch}`;
    else out += ch;
  }
  return out;
}

/** one row of the ranges, as a condition that is true when it matches */
function rowCondition(expr, type, kind, row) {
  const option = upper(row.OPTION);
  const low = () => bound(row.LOW, type, kind);
  const high = () => bound(row.HIGH, type, kind);
  const compare = {EQ: "=", NE: "<>", GT: ">", GE: ">=", LT: "<", LE: "<="}[option];
  if (compare !== undefined) return bin(compare, expr, low(), T.bool);
  if (option === "BT" || option === "NB") {
    const between = and(bin(">=", expr, low(), T.bool), bin("<=", expr, high(), T.bool));
    return option === "BT" ? between : not(between);
  }
  if (option === "CP" || option === "NP") {
    if (type?.abap !== "C" && type?.abap !== "STRING") throw new RangesError(`${option} over a column of type ${type?.abap} is not carried`);
    // a CHAR pattern loses its trailing blanks like any CHAR value
    const source = type.abap === "C" ? String(row.LOW ?? "").replace(/ +$/, "") : String(row.LOW ?? "");
    return like(expr, lit(likePattern(source), T.str), lit("#", T.str), option === "NP");
  }
  throw new RangesError(`range OPTION ${JSON.stringify(row.OPTION)} is not one ABAP knows`);
}

/**
 * `column IN ranges` as an IR condition.
 * @param column  an IR expression (usually col(name, type)) or a column name
 * @param type    the column's IR type ({abap: "C", len} / {abap: "I"} / STRING)
 * @param rows    [{SIGN, OPTION, LOW, HIGH}] -- keys in any case
 * @param options {kind: "NUMC"} when a C column is NUMC
 */
export function rangesPredicate(column, type, rows, options = {}) {
  const expr = typeof column === "string" ? col(upper(column), type) : column;
  const normal = (rows ?? []).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [upper(k), v])));
  if (normal.length === 0) return TRUE();
  const sign = (s) => normal.filter((row) => upper(row.SIGN) === s);
  const unknown = normal.find((row) => !["I", "E"].includes(upper(row.SIGN)));
  if (unknown !== undefined) throw new RangesError(`range SIGN ${JSON.stringify(unknown.SIGN)} is not I or E`);
  const include = sign("I").map((row) => rowCondition(expr, type, options.kind, row));
  const exclude = sign("E").map((row) => rowCondition(expr, type, options.kind, row));
  const included = include.length === 0 ? undefined : or(include);
  const excluded = exclude.length === 0 ? undefined : not(or(exclude));
  if (included !== undefined && excluded !== undefined) return and(included, excluded);
  return included ?? excluded;
}

// Where a range predicate arrives at run time, for a host that lowers the
// statement at build time: lower() renders it as a marker that is not a
// parameter -- an SQL comment `@range:<id>` -- and lists it in the result's
// `hostPreds` (with `after`, the number of parameters before it), and the
// host puts its rangesPredicate() rendering in the marker's place.
export const hostPred = (id, column, columnType, options = {}) =>
  ({node: "hostPred", id: String(id), column: upper(column), columnType,
    ...(options.kind === undefined ? {} : {kind: options.kind}), type: T.bool});

/**
 * A condition alone, rendered by the same lower() a whole statement uses:
 * the SQL a host splices into a hostPred marker, with its own parameters in
 * order. Rendered as the WHERE of a one-table select and cut out, so there
 * is no second renderer to drift from the first.
 */
export function lowerPredicate(pred, dialect) {
  const {sql, params} = lower(filter(scan("__RANGES__"), pred), dialect);
  const prefixes = [`SELECT * FROM "__RANGES__" WHERE `];
  const prefix = prefixes.find((one) => sql.startsWith(one));
  if (prefix === undefined) throw new RangesError(`lowerPredicate: ${dialect} rendered an unexpected shape: ${sql.slice(0, 60)}`);
  return {sql: sql.slice(prefix.length), params};
}
