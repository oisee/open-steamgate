// A transpiler DatabaseClient over DuckDB (in-process, columnar). The
// generated Open SQL is PostgreSQL-flavoured and DuckDB speaks that, so this
// is the PG client's shape with @duckdb/node-api underneath: transactions
// for the ABAP LUW, subrc/dbcnt from the affected-row count, rows as plain
// objects with the runtime's lowercase column names.
import {DuckDBInstance} from "@duckdb/node-api";
import {bindValue} from "./abap-types.mjs";
import {trimLiterals} from "./sql-literals.mjs";


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
    this.connected = false;
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
    // Match the SQLite and HANA clients: sy-dbsys is a fact about the
    // connection that actually opened, not a label supplied by status or
    // configuration. Keep the assignment after connect succeeds.
    if (globalThis.abap?.context?.databaseConnections?.DEFAULT === this) {
      globalThis.abap.builtin.sy.get().dbsys?.set(this.name);
    }
    this.connected = true;
  }

  async disconnect() {
    await this.commit();
    this.connection?.closeSync?.();
    this.instance?.closeSync?.();
    this.connection = undefined;
    this.instance = undefined;
    this.connected = false;
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

  // ---------------------------------------------------------------------
  // The native channel (docs/db-seam-native.md), for one caller: the
  // SQLScript splitter's lowering. **Nothing transpiled from ABAP may reach
  // these** -- Open SQL goes through select()/insert()/update()/delete(),
  // which rewrite and trim; a statement arriving here is sent untouched.
  // ---------------------------------------------------------------------

  get supportsNative() {
    return true;
  }

  /** ABAP's type letters into values DuckDB will bind */
  #bind(params = []) {
    return params.map((p) => {
      if (p.isNull === true) return null;
      return bindValue(p);
    });
  }

  async native({sql, params = [], expect = "rows"}) {
    if (this.trace) console.log("native:", sql, params.length ? JSON.stringify(params) : "");
    const prepared = await this.connection.prepare(sql);
    const bound = this.#bind(params);
    bound.forEach((v, i) => prepared.bind({[String(i + 1)]: v}));
    const result = await prepared.runAndReadAll();
    if (expect === "none") {
      return {rowCount: undefined};
    }
    // the engine's declared column types, not a guess from the JavaScript
    // value: blank padding, decimals and dates are where guessing hurts
    const columns = result.columnNames().map((name, i) => ({name, type: result.columnTypes()[i]?.typeId}));
    const rows = result.getRowObjects().map((r) => {
      const row = {};
      for (const k of Object.keys(r)) row[k] = plain(r[k]);
      return row;
    });
    if (expect === "scalar") {
      const first = rows[0];
      return {value: first === undefined ? undefined : first[Object.keys(first)[0]], columns};
    }
    return {rows, columns, rowCount: rows.length};
  }

  /** A named relation later statements may refer to. The name is ours: the
   *  caller may not invent one, because quoting is the engine's business. */
  async defineRelation({name = "rel", sql, params = [], materialise}) {
    // A **definition** carrying bind values would have to keep them alive for
    // the life of the relation, which is why this refuses. A **materialised**
    // relation would not: `CREATE TABLE ... AS <select>` consumes the values
    // once, at creation, and the table that remains carries rows and no
    // parameters. The refusal used to cover both, and so was wider than its
    // own reason by exactly the case the divergence instrument needs -- a
    // literal is in almost every real body, so forcing a step that carried one
    // was impossible and "no divergences found" would have been a statement
    // about how little we forced (fable-osd, 2026-09-19).
    if (params.length > 0 && materialise === undefined) {
      throw new Error("defineRelation: params are not supported on a definition; materialise it, or bind at use");
    }
    this.relationCount = (this.relationCount ?? 0) + 1;
    const ident = `OSD_${String(name).replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}_${process.pid}_${this.relationCount}`;
    const handle = {ident, ref: `"${ident}"`, kind: materialise === undefined ? "definition" : "materialised", reason: materialise};
    // an ordinary table rather than a temporary one, for the same reason as
    // in the HANA client: the reference must be spliceable anywhere. The
    // client drops it, so a conformance run leaves nothing behind.
    if (materialise === undefined) {
      await this.execute(`CREATE VIEW ${handle.ref} AS ${sql}`);
    } else {
      await this.native({sql: `CREATE TABLE ${handle.ref} AS ${sql}`, params, expect: "none"});
    }
    return handle;
  }

  relationRef(handle) {
    return handle.ref;
  }

  relationKind(handle) {
    return {kind: handle.kind, reason: handle.reason};
  }

  async dropRelation(handle) {
    await this.execute(`DROP ${handle.kind === "definition" ? "VIEW" : "TABLE"} ${handle.ref}`).catch(() => undefined);
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
