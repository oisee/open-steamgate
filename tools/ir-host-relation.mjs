// A table the host already holds, handed to a relational plan as a relation:
// an AMDP's IN table, the itab of FOR ALL ENTRIES. The contract is the one
// agreed with the Go runtime (foreman-dell, 2026-09-24), whose client
// answers it with a SQLite virtual table over the host's own memory; this
// module is the reference every client without one uses, and the pairs
// (tools/ir-host-relation-pairs.mjs) are what both must answer alike.
//
//   rows = {length, get(i, column)}      i in 0..length-1, column upper case
//
//   - get() never answers null: an ABAP row has no NULL. A field it does not
//     name (undefined) is the type's initial value, the same as a work area
//     left untouched -- ir-writes' bindValue, so C is right-trimmed, P is the
//     decimal string of its type, D is CHAR 8 ('00000000' initial), INT8 a
//     BigInt past 2^53.
//   - The rows come out in index order, 0 first: an IN table's order is the
//     caller's. The relation carries the index as a column, OSD_ORD, beside
//     the schema's; hostPlan() projects it away and tells the order rules it
//     is there. Nothing is pushed down: the engine filters and sorts.
//   - The handle lives for one call. The caller drops it in a finally, a
//     second drop is not an error, and after the drop no reference to the
//     rows is held -- which is what makes reading them in place legal: IN is
//     by VALUE, the call is synchronous, and ABAP is single-threaded.
//
// Here the rows are copied once into a table of the column types, a batch of
// INSERTs rendered by lower() from ir-writes' insertRows -- no union of
// single-row selects, so no compound-SELECT limit (SQLite's 500 terms) and no
// plan whose size grows with the table. A type this cannot bind answers
// undefined, and the caller keeps its union.
import {insertRows, bindValue, WriteError} from "./ir-writes.mjs";
import {lower} from "./sqlscript-lower.mjs";
import {T, lit, col, project, refTo} from "./sqlscript-ir.mjs";

/** the index of a row, 0 first, beside the schema's columns: the relation
 *  hands it to the order rules (orderOf), so a FOR over an IN table walks
 *  the caller's rows in the caller's order, as the union path did */
export const ORDINAL = "OSD_ORD";

const upper = (v) => String(v).toUpperCase();

/** the column type a host relation's table is created with, per dialect;
 *  undefined for a type the contract does not carry yet */
export function columnType(type, dialect) {
  switch (type?.abap) {
    case "I": return "INTEGER";
    case "INT8": return dialect === "sqlite" ? "INTEGER" : "BIGINT";
    case "P": {
      const len = type.len ?? 31;
      const dec = type.dec ?? 0;
      return `DECIMAL(${len}, ${dec})`;
    }
    case "C": {
      if (dialect === "sqlite") return "TEXT";
      if (dialect === "hana") return `NVARCHAR(${type.len ?? 1})`;
      return type.len === undefined ? "VARCHAR" : `VARCHAR(${type.len})`;
    }
    case "D": return dialect === "sqlite" ? "TEXT" : dialect === "hana" ? "NVARCHAR(8)" : "VARCHAR(8)";
    case "STRING": return dialect === "sqlite" ? "TEXT" : dialect === "hana" ? "NCLOB" : "VARCHAR";
    default: return undefined;
  }
}

/** can this schema travel as a host relation on this dialect? */
export const carries = (schema, dialect) => Object.values(schema).every((type) => columnType(type, dialect) !== undefined);

/** the rows as ir-writes values, in index order: what a host relation holds */
export function boundRows(schema, rows) {
  const columns = Object.keys(schema).map(upper);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    out.push(columns.map((column) => {
      const value = rows.get(i, column);
      if (value === null) throw new WriteError(`row ${i} column ${column}: get() answered null, and an ABAP row has none`);
      return bindValue(value, schema[column]);
    }));
  }
  return out;
}

/** a batch small enough for every engine's placeholder limit (SQLite's
 *  default is 32766, HANA takes one VALUES row per statement anyway) */
const BATCH_CELLS = 2000;

/**
 * Put the host's rows where the client's relations live and answer a handle
 * for refTo(handle, schema); undefined when the schema carries a type this
 * does not bind, or the client has no materialised relations.
 */
export async function hostRelation(client, dialect, {name = "host", schema, rows}) {
  if (client?.relationDdl !== true || typeof client.native !== "function") return undefined;
  if (!carries(schema, dialect)) return undefined;
  const columns = Object.keys(schema).map(upper);
  if (columns.includes(ORDINAL)) throw new WriteError(`a host relation may not have a column named ${ORDINAL}`);
  const values = boundRows(schema, rows).map((row, i) => [...row, lit(i, T.int)]);
  const quote = (ident) => `"${ident.replace(/"/g, '""')}"`;
  const handle = await client.defineRelation({
    name, materialise: "host rows",
    ddl: (ref) => `CREATE TABLE ${ref} (${[...columns.map((c) => `${quote(c)} ${columnType(schema[c], dialect)}`), `${quote(ORDINAL)} INTEGER`].join(", ")})`,
  });
  try {
    const per = dialect === "hana" ? 1 : Math.max(1, Math.floor(BATCH_CELLS / Math.max(columns.length, 1)));
    for (let at = 0; at < values.length; at += per) {
      await client.native({...lower(insertRows(handle.ident, [...columns, ORDINAL], values.slice(at, at + per)), dialect), expect: "none"});
    }
  } catch (error) {
    await client.dropRelation(handle);
    throw error;
  }
  return handle;
}

/** the plan a host relation stands for: the schema's columns, in its order,
 *  over the handle, with the ordinal known to the order rules */
export function hostPlan(handle, schema) {
  const columns = Object.keys(schema).map(upper);
  const source = {...refTo(handle, {...Object.fromEntries(columns.map((c) => [c, schema[c]])), [ORDINAL]: T.int}), ordinal: ORDINAL};
  return project(source, columns.map((c) => ({as: c, expr: col(c, schema[c])})));
}

/** rows over an ABAP internal table: its lines' fields by name, index order */
export function abapTableRows(table) {
  const lines = table.array();
  const field = (line, column) => {
    const inner = typeof line?.get === "function" ? line.get() : line;
    if (inner === null || typeof inner !== "object") return undefined;
    const key = Object.keys(inner).find((k) => upper(k) === column);
    const v = key === undefined ? undefined : inner[key];
    return typeof v?.get === "function" ? v.get() : v;
  };
  return {length: lines.length, get: (i, column) => field(lines[i], column)};
}

/** rows over plain objects (tests, a JavaScript caller) */
export function objectRows(list) {
  return {length: list.length, get: (i, column) => {
    const row = list[i];
    const key = Object.keys(row).find((k) => upper(k) === column);
    return key === undefined ? undefined : row[key];
  }};
}
