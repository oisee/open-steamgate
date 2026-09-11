// A transpiler DatabaseClient over DuckDB (in-process, columnar). The
// generated Open SQL is PostgreSQL-flavoured and DuckDB speaks that, so this
// is the PG client's shape with @duckdb/node-api underneath: transactions
// for the ABAP LUW, subrc/dbcnt from the affected-row count, rows as plain
// objects with the runtime's lowercase column names.
import {DuckDBInstance} from "@duckdb/node-api";

// ABAP compares CHAR values ignoring trailing blanks and the runtime pads
// its literals to the field length; VARCHAR columns keep what they get, so
// literals are trimmed on the way in and in comparisons.
function trimLiterals(sql) {
  return sql.replace(/'((?:[^']|'')*)'/g, (m, inner) => "'" + inner.replace(/ +$/, "") + "'");
}

function plain(value) {
  if (typeof value === "bigint") return Number(value);
  if (value === null || value === undefined) return value;
  if (typeof value === "object" && typeof value.toString === "function" && !(value instanceof Date)) return value.toString();
  return value;
}

export class DuckDBDatabaseClient {
  constructor(input = {}) {
    this.name = "duckdb";
    this.path = input.path ?? ":memory:";
    this.trace = input.trace === true;
    this.instance = undefined;
    this.connection = undefined;
    this.inTransaction = false;
    // successful modifying statements of the open LUW, replayed when a
    // failed statement aborts the DuckDB transaction (savepoint emulation)
    this.luw = [];
  }

  async connect() {
    this.instance = await DuckDBInstance.create(this.path);
    this.connection = await this.instance.connect();
  }

  async disconnect() {
    await this.commit();
    this.connection?.closeSync?.();
    this.instance?.closeSync?.();
    this.connection = undefined;
    this.instance = undefined;
  }

  // a persisted file already carries the schema and the seed
  async hasSchema() {
    const rows = await this.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = 'zstg_demo'");
    return Number(rows[0]?.n ?? 0) > 0;
  }

  async execute(sql) {
    if (Array.isArray(sql)) {
      for (const s of sql) await this.execute(s);
      return;
    }
    if (sql === "") return;
    if (/^\s*INSERT/i.test(sql)) sql = trimLiterals(sql);
    if (this.trace) console.log(sql);
    await this.connection.run(sql);
  }

  // The ABAP LUW: INSERT/UPDATE/DELETE open a transaction, COMMIT WORK and
  // ROLLBACK WORK end it. A statement that fails (duplicate key -> subrc 4)
  // aborts a DuckDB transaction and there are no savepoints to fence it the
  // way the PG client does, so the successful statements of the LUW are kept
  // and replayed into a fresh transaction after a failure. Deterministic SQL
  // makes the replay equivalent to a ROLLBACK TO SAVEPOINT.
  async beginTransaction() {
    if (this.inTransaction) return;
    await this.connection.run("BEGIN TRANSACTION");
    this.inTransaction = true;
    this.luw = [];
  }

  async commit() {
    if (!this.inTransaction) return;
    await this.connection.run("COMMIT");
    this.inTransaction = false;
    this.luw = [];
  }

  async rollback() {
    if (!this.inTransaction) return;
    await this.connection.run("ROLLBACK");
    this.inTransaction = false;
    this.luw = [];
  }

  async replayAfterFailure() {
    await this.connection.run("ROLLBACK");
    await this.connection.run("BEGIN TRANSACTION");
    for (const sql of this.luw) {
      await this.connection.run(sql);
    }
  }

  async modifying(sql) {
    await this.beginTransaction();
    if (this.trace) console.log(sql);
    let result;
    try {
      result = await this.connection.runAndReadAll(sql);
    } catch (error) {
      await this.replayAfterFailure();
      throw error;
    }
    this.luw.push(sql);
    const rows = result.getRowObjects();
    // DuckDB reports the affected row count as a single-row result
    const n = rows.length > 0 ? Number(Object.values(rows[0])[0] ?? 0) : 0;
    return n;
  }

  async delete(options) {
    let sql = `DELETE FROM ${options.table}`;
    if (options.where !== "") sql += ` WHERE ${options.where}`;
    sql = trimLiterals(sql);
    try {
      const dbcnt = await this.modifying(sql);
      return {subrc: dbcnt === 0 ? 4 : 0, dbcnt};
    } catch (e) {
      if (this.trace) console.error(e);
      return {subrc: 4, dbcnt: 0};
    }
  }

  async update(options) {
    const sql = trimLiterals(`UPDATE ${options.table} SET ${options.set.join(", ")} WHERE ${options.where}`);
    try {
      const dbcnt = await this.modifying(sql);
      return {subrc: dbcnt === 0 ? 4 : 0, dbcnt};
    } catch (e) {
      if (this.trace) console.error(e);
      return {subrc: 4, dbcnt: 0};
    }
  }

  async insert(options) {
    const sql = trimLiterals(`INSERT INTO ${options.table} (${options.columns.map((c) => '"' + c + '"').join(",")}) VALUES (${options.values.join(",")})`);
    try {
      const dbcnt = await this.modifying(sql);
      return {subrc: 0, dbcnt};
    } catch (e) {
      if (this.trace) console.error(e);
      return {subrc: 4, dbcnt: 0};
    }
  }

  rewrite(select, primaryKey) {
    let s = select.replace(/ UP TO (\d+) ROWS(.*)/i, "$2 LIMIT $1");
    s = primaryKey ? s.replace(/ ORDER BY PRIMARY KEY/i, " ORDER BY " + primaryKey.join(", ")) : s.replace(/ ORDER BY PRIMARY KEY/i, "");
    s = s.replace(/ ASCENDING/ig, " ASC").replace(/ DESCENDING/ig, " DESC").replace(/~/g, ".").replace(/ LIMIT 0/g, "");
    return trimLiterals(s);
  }

  async query(sql) {
    if (this.trace) console.log(sql);
    try {
      const result = await this.connection.runAndReadAll(sql);
      return result.getRowObjects().map((r) => {
        const row = {};
        for (const k of Object.keys(r)) row[k] = plain(r[k]);
        return row;
      });
    } catch (error) {
      if (globalThis.abap?.Classes?.["CX_SY_DYNAMIC_OSQL_SEMANTICS"] !== undefined) {
        throw await new globalThis.abap.Classes["CX_SY_DYNAMIC_OSQL_SEMANTICS"]().constructor_({sqlmsg: error.message || ""});
      }
      throw error;
    }
  }

  async select(options) {
    options.select = this.rewrite(options.select, options.primaryKey);
    return {rows: await this.query(options.select)};
  }

  async openCursor(options) {
    const rows = await this.query(this.rewrite(options.select, options.primaryKey));
    let offset = 0;
    return {
      fetchNextCursor: async (packageSize) => {
        const slice = rows.slice(offset, offset + packageSize);
        offset += packageSize;
        return {rows: slice};
      },
      closeCursor: async () => undefined,
    };
  }
}

// The transpiler writes its DDL and seed rows for SQLite; DuckDB wants the
// PostgreSQL flavour it also writes, with two touch-ups.
export function duckdbSchema(schemas) {
  return schemas.pg.map((s) => s.replace(/NCHAR\((\d+)\)/g, "VARCHAR($1)"));
}

export function duckdbInserts(inserts) {
  // INSERT INTO reposrc ('PROGNAME', 'DATA') -> ("progname", "data")
  return inserts.map((s) => s.replace(/^(INSERT INTO \S+ \()([^)]*)\)/i, (m, head, cols) =>
    head + cols.replace(/'([A-Za-z_0-9]+)'/g, (mm, c) => '"' + c.toLowerCase() + '"') + ")"));
}
