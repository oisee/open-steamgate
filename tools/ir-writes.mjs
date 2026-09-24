// Writes as IR: INSERT, UPDATE, DELETE and MODIFY (an upsert by key), for a
// host that turns ABAP Open SQL into this IR and lowers it -- the Go runtime
// at build time, a JS host at run time. The statement is rendered by the
// same lower() a SELECT is (tools/sqlscript-lower.mjs), so its values and
// conditions are the same placeholders and the same dialect texts; the pairs
// a port is checked against are tools/ir-writes-pairs.mjs's.
//
// What the node carries is what the SQL needs; what ABAP makes of the answer
// is the host's (sy-dbcnt the rows affected, sy-subrc 4 when none). The
// duplicate-key rules, measured on A4H by the dbwrite agent (branch
// ultra/dbwrite, ANORMALIES dbwrite-*):
//   - INSERT dbtab FROM wa, a duplicate: sy-subrc 4, nothing written --
//     onDuplicate "error": one plain INSERT, the engine raises, the host
//     answers 4;
//   - INSERT dbtab FROM TABLE itab, a duplicate: CX_SY_OPEN_SQL_DB, and every
//     non-duplicate row IS written (a duplicate inside the itab too: the
//     first written, then the raise) -- onDuplicate "raise": rendered as the
//     skipping INSERT, and the host raises when fewer rows were written than
//     given (`rows.length` is on the node);
//   - ACCEPTING DUPLICATE KEYS: sy-subrc 4, the rest written -- "ignore".
// UPDATE dbtab FROM TABLE is one UPDATE per row by key with the counts summed
// (a missing row: sy-subrc 4); DELETE dbtab FROM wa / FROM TABLE match on the
// primary key only: the front end builds those predicates from the key.
// MODIFY writes the whole work area, row by row, the last row of a key wins.
//
// The front end puts MANDT into the rows and the conditions (the logon
// client) and binds CHAR right-trimmed, as the column holds it on HANA. A
// remove() or update() without a predicate touches every row of every
// client: lower() adds no MANDT, by contract.
import {T, lit} from "./sqlscript-ir.mjs";

export class WriteError extends Error {}

const upper = (v) => String(v ?? "").toUpperCase();
const names = (columns) => columns.map(upper);

/** ABAP's initial value of a column type: what a work-area field holds untouched */
export function initialValue(type) {
  if (type?.abap === "I" || type?.abap === "INT8") return lit(0, type);
  if (type?.abap === "C" || type?.abap === "STRING") return lit("", type);
  if (type?.abap === "P") return lit(packedText("0", type, "the initial value"), type);
  throw new WriteError(`a column of type ${type?.abap ?? "unknown"} has no initial value here yet`);
}

/**
 * A packed value as the decimal string of its type: exactly `dec` digits
 * after the point, no exponent, no -0. It is what an ABAP work area's P field
 * holds, so a value it could not hold is refused rather than rounded: more
 * decimals than the type has (unless the extra ones are zeros), or more
 * digits than its length -- rounding on the way in is ABAP's assignment, not
 * the write's, and was not measured here.
 *
 * The text grammar is abapNumber's (tools/ir-osql-where.mjs): blanks around
 * it are skipped (spaces only -- a tab is not a blank), a sign may lead or
 * trail ('5-' is -5, as ABAP writes it), digits on both sides of a point.
 * The one difference is on purpose: abapNumber converts a WHERE literal and
 * rounds half away from zero, as A4H does; a work area already holds its
 * value, so here extra decimals are refused, never rounded.
 *
 * A JavaScript number is read by its shortest text and is refused past
 * 2^53, where that text is no longer the number the caller meant: a caller
 * with more digits passes a string. The type is checked as DDIC has it:
 * `len` 1..31 digits (31 when absent), `dec` 0..14 and not above `len`.
 */
export function packedText(value, type, what = "value") {
  const len = type?.len === undefined ? 31 : type.len;
  const dec = type?.dec === undefined ? 0 : type.dec;
  if (!Number.isInteger(len) || len < 1 || len > 31) throw new WriteError(`a packed type of length ${JSON.stringify(type?.len)}: DDIC allows 1 to 31 digits`);
  if (!Number.isInteger(dec) || dec < 0 || dec > 14 || dec > len) throw new WriteError(`a packed type with ${JSON.stringify(type?.dec)} decimals: DDIC allows 0 to 14, and not more than its ${len} digits`);
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new WriteError(`${what} ${JSON.stringify(value)} is not a decimal number`);
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new WriteError(`${what} ${value} is past 2^53 as a JavaScript number: pass it as a decimal string`);
    text = String(value);
  } else if (typeof value === "string" || typeof value === "bigint") {
    text = String(value).replace(/^ +| +$/g, "");
  } else {
    throw new WriteError(`${what} ${JSON.stringify(value)} is not a decimal number`);
  }
  const m = /^([+-]?)(\d+)(?:\.(\d+))?([+-]?)$/.exec(text);
  if (m === null || (m[1] !== "" && m[4] !== "")) throw new WriteError(`${what} ${JSON.stringify(value)} is not a decimal number`);
  const fraction = m[3] ?? "";
  if (fraction.length > dec && /[1-9]/.test(fraction.slice(dec))) {
    throw new WriteError(`${what} ${JSON.stringify(value)} has more than the column's ${dec} decimals`);
  }
  const whole = m[2].replace(/^0+(?=\d)/, "");
  const digits = fraction.padEnd(dec, "0").slice(0, dec);
  if ((whole === "0" ? 0 : whole.length) + dec > len) {
    throw new WriteError(`${what} ${JSON.stringify(value)} does not fit the column's ${len} digits`);
  }
  const zero = /^0*$/.test(whole + digits);
  return `${(m[1] || m[4]) === "-" && !zero ? "-" : ""}${whole}${dec > 0 ? `.${digits}` : ""}`;
}

/**
 * A value bound as the column's type binds it: CHAR right-trimmed, INTEGER a
 * number, STRING unchanged, a packed number as its decimal string. A field the row does not name is ABAP's initial
 * value (a work area has no NULL); an explicit null is refused.
 */
export function bindValue(value, type) {
  if (value === undefined) return initialValue(type);
  if (value === null) throw new WriteError("a NULL value: an ABAP work area has none");
  if (type?.abap === "I" || type?.abap === "INT8") {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new WriteError(`value ${JSON.stringify(value)} is not an INTEGER`);
    return lit(n, type);
  }
  if (type?.abap === "C") {
    const text = String(value).replace(/ +$/, "");
    if (Number.isInteger(type.len) && text.length > type.len) throw new WriteError(`value ${JSON.stringify(value)} is longer than the column's ${type.len}`);
    return lit(text, type);
  }
  if (type?.abap === "STRING") return lit(String(value), type);
  if (type?.abap === "P") return lit(packedText(value, type, "value"), type);
  throw new WriteError(`a column of type ${type?.abap ?? "unknown"} is not written yet`);
}

/** rows of plain values into rows of IR values, by the table's column types */
export function bindRows(columns, schema, rows) {
  return rows.map((row) => columns.map((column) => {
    const key = Object.keys(row).find((k) => upper(k) === upper(column));
    const type = schema[upper(column)];
    if (type === undefined) throw new WriteError(`column ${upper(column)} is not in the table's schema`);
    return bindValue(key === undefined ? undefined : row[key], type);
  }));
}

/**
 * A packed literal a statement writes must be the decimal string of its
 * type, whoever built it: a lit(1.5, P) made by hand, not through
 * bindValue, would reach the client as a JavaScript number and bind as a
 * double. Checked where values are written (rows, SET), not in conditions.
 */
function checkWritten(node) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(checkWritten); return; }
  if (node.node === "lit" && node.type?.abap === "P") {
    if (typeof node.value !== "string" || packedText(node.value, node.type) !== node.value) {
      throw new WriteError(`a packed literal ${JSON.stringify(node.value)} is not the decimal string of P(${node.type.len ?? 31},${node.type.dec ?? 0}): bind it with bindValue`);
    }
    return;
  }
  for (const value of Object.values(node)) checkWritten(value);
}

const DUPLICATES = ["error", "raise", "ignore"];
const checkDuplicates = (onDuplicate) => {
  if (!DUPLICATES.includes(onDuplicate)) throw new WriteError(`onDuplicate ${JSON.stringify(onDuplicate)} is error, raise or ignore`);
};

/** INSERT dbtab FROM wa ("error") / FROM TABLE itab ("raise") / ACCEPTING DUPLICATE KEYS ("ignore") */
export const insertRows = (table, columns, rows, {onDuplicate = "error"} = {}) => {
  checkDuplicates(onDuplicate);
  if (rows.length === 0) throw new WriteError("an INSERT with no rows");
  if (rows.some((row) => row.length !== columns.length)) throw new WriteError("a row does not have one value per column");
  checkWritten(rows);
  return {write: "insert", table: upper(table), columns: names(columns), rows, onDuplicate,
    ...(onDuplicate === "raise" ? {expected: rows.length} : {})};
};
/** INSERT dbtab FROM ( SELECT ... ): a relation whose columns are the table's, in order */
export const insertFrom = (table, columns, rel, {onDuplicate = "error"} = {}) => {
  checkDuplicates(onDuplicate);
  return {write: "insert", table: upper(table), columns: names(columns), from: rel, onDuplicate};
};
/** UPDATE dbtab SET ... WHERE ...; `pred` undefined updates every row */
export const update = (table, set, pred) => {
  if (set.length === 0) throw new WriteError("an UPDATE that sets nothing");
  checkWritten(set.map((one) => one.expr));
  return {write: "update", table: upper(table), set: set.map((one) => ({col: upper(one.col), expr: one.expr})), ...(pred === undefined ? {} : {pred})};
};
/** DELETE FROM dbtab WHERE ...; `pred` undefined deletes every row */
export const remove = (table, pred) => ({write: "delete", table: upper(table), ...(pred === undefined ? {} : {pred})});
/** MODIFY dbtab FROM wa / FROM TABLE itab: insert, or update the row of the same key */
export const upsert = (table, columns, rows, key) => {
  const cols = names(columns);
  const keys = names(key);
  if (keys.length === 0) throw new WriteError("a MODIFY needs the table's key columns");
  if (keys.some((k) => !cols.includes(k))) throw new WriteError("a MODIFY's key columns must be among its columns");
  if (rows.length === 0) throw new WriteError("a MODIFY with no rows");
  if (rows.some((row) => row.length !== cols.length)) throw new WriteError("a row does not have one value per column");
  checkWritten(rows);
  // ABAP writes row by row and the last row of a key wins; one statement
  // would differ per engine (SQLite keeps the last, DuckDB the first,
  // PostgreSQL refuses), so the earlier rows of a key are dropped here
  const at = keys.map((k) => cols.indexOf(k));
  const keyOf = (row) => {
    const parts = at.map((i) => row[i]);
    if (parts.some((e) => e?.node !== "lit")) throw new WriteError("a MODIFY row whose key is not a bound value cannot be ordered by key");
    return JSON.stringify(parts.map((e) => e.value));
  };
  const last = new Map(rows.map((row, i) => [keyOf(row), i]));
  const kept = rows.filter((row, i) => last.get(keyOf(row)) === i);
  return {write: "upsert", table: upper(table), columns: cols, rows: kept, key: keys};
};
