// Writes as IR: INSERT, UPDATE, DELETE and MODIFY (an upsert by key), for a
// host that turns ABAP Open SQL into this IR and lowers it -- the Go runtime
// at build time, a JS host at run time. The statement is rendered by the
// same lower() a SELECT is (tools/sqlscript-lower.mjs), so its values and
// conditions are the same placeholders and the same dialect texts; the pairs
// a port is checked against are tools/ir-writes-pairs.mjs's.
//
// What the node carries is what the SQL needs; what ABAP makes of the answer
// is the host's: sy-dbcnt is the rows affected, sy-subrc 4 when none, and a
// duplicate key is sy-subrc 4 for a single INSERT, a dump for INSERT FROM
// TABLE, and sy-subrc 4 with the rest inserted under ACCEPTING DUPLICATE
// KEYS (foreman-dell's summary, to be measured on A4H). So the node says
// only whether a duplicate is an error ("error": plain INSERT, the engine
// raises) or skipped ("ignore": ON CONFLICT DO NOTHING).
//
// The front end puts MANDT into the rows and the conditions (the logon
// client) and binds CHAR right-trimmed, as the column holds it on HANA.
import {T, lit} from "./sqlscript-ir.mjs";

export class WriteError extends Error {}

const upper = (v) => String(v ?? "").toUpperCase();
const names = (columns) => columns.map(upper);

/** a value bound as the column's type binds it: CHAR right-trimmed, INTEGER a number */
export function bindValue(value, type) {
  if (value === null || value === undefined) return lit(null, type);
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
  throw new WriteError(`a column of type ${type?.abap ?? "unknown"} is not written yet`);
}

/** rows of plain values into rows of IR values, by the table's column types */
export function bindRows(columns, schema, rows) {
  return rows.map((row) => columns.map((column) => {
    const key = Object.keys(row).find((k) => upper(k) === upper(column));
    const type = schema[upper(column)];
    if (type === undefined) throw new WriteError(`column ${upper(column)} is not in the table's schema`);
    return bindValue(key === undefined ? null : row[key], type);
  }));
}

/** INSERT dbtab FROM wa / FROM TABLE itab: rows of IR values */
export const insertRows = (table, columns, rows, {onDuplicate = "error"} = {}) => {
  if (!["error", "ignore"].includes(onDuplicate)) throw new WriteError(`onDuplicate ${JSON.stringify(onDuplicate)} is error or ignore`);
  if (rows.length === 0) throw new WriteError("an INSERT with no rows");
  if (rows.some((row) => row.length !== columns.length)) throw new WriteError("a row does not have one value per column");
  return {write: "insert", table: upper(table), columns: names(columns), rows, onDuplicate};
};
/** INSERT dbtab FROM ( SELECT ... ): a relation whose columns are the table's, in order */
export const insertFrom = (table, columns, rel, {onDuplicate = "error"} = {}) =>
  ({write: "insert", table: upper(table), columns: names(columns), from: rel, onDuplicate});
/** UPDATE dbtab SET ... WHERE ...; `pred` undefined updates every row */
export const update = (table, set, pred) => {
  if (set.length === 0) throw new WriteError("an UPDATE that sets nothing");
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
  return {write: "upsert", table: upper(table), columns: cols, rows, key: keys};
};
