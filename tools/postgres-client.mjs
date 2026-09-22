// PostgreSQL connection and first-run seed for the OSD runtime.
// A dedicated database is the isolation boundary; this client uses its public
// schema and never drops or rewrites a pre-existing schema.
import {PostgresDatabaseClient} from "@abaplint/database-pg";
import {fingerprintOf} from "./osd-persist.mjs";
import {abapTypeLetter, bindValue} from "./abap-types.mjs";
import {randomBytes} from "node:crypto";

function bindNativeValue(parameter) {
  if (parameter.isNull === true) return null;
  // node-postgres accepts a decimal as text and lets the target expression
  // give it a NUMERIC type. Passing through Number here would lose decimal
  // digits before PostgreSQL ever sees them.
  if (abapTypeLetter(parameter.type) === "P") return String(parameter.value);
  return bindValue(parameter, {hex: (value) => Buffer.from(value, "hex")});
}

export class OsdPostgresClient extends PostgresDatabaseClient {
  constructor(input = {}) {
    super({
      host: input.host ?? process.env.PGHOST ?? "postgres",
      port: Number(input.port ?? process.env.PGPORT ?? 5432),
      user: input.user ?? process.env.PGUSER ?? "osd",
      password: input.password ?? process.env.PGPASSWORD,
      database: input.database ?? process.env.PGDATABASE ?? "osd",
      trace: input.trace === true,
    });
    this.connected = false;
    // A persistent relation can outlive a crashed process. PID + counter can
    // then collide after a container restart, so give every client a short
    // random namespace. Twelve hex characters keep the complete identifier
    // below PostgreSQL's 63-byte identifier limit.
    this.relationScope = randomBytes(6).toString("hex").toUpperCase();
  }

  async connect() {
    await super.connect(); // constructs a pool; it has not opened a socket yet
    try {
      const answer = await this.select({select: "SELECT 1 AS osd_connected"});
      if (Number(answer.rows?.[0]?.osd_connected) !== 1) throw new Error("PostgreSQL connection probe returned no row");
      this.connected = true;
    } catch (error) {
      await super.disconnect();
      throw error;
    }
  }

  async disconnect() {
    try { await super.disconnect(); }
    finally { this.connected = false; }
  }

  async checkSelect(sql) {
    const text = sql.replace(/ UP TO (\d+) ROWS(.*)/i, "$2 LIMIT $1")
      .replace(/ ORDER BY PRIMARY KEY/i, "")
      .replace(/ ASCENDING/ig, " ASC")
      .replace(/ DESCENDING/ig, " DESC")
      .replace(/ LIMIT 0/g, "")
      .replace(/~/g, ".");
    // PREPARE parses and resolves the SELECT without running it. Always use
    // a separate physical session: a bad editor query must not abort an ABAP
    // LUW that happens to be open on this.client at the same time.
    const session = await this.pool.connect();
    const name = `osd_check_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    try {
      await session.query(`PREPARE ${name} AS ${text}`);
    } finally {
      await session.query(`DEALLOCATE ${name}`).catch(() => undefined);
      session.release();
    }
  }

  async hasSchema(schema) {
    const wanted = fingerprintOf(schema);
    const stamp = await this.select({select: "SELECT to_regclass('osd_schema') AS name"});
    if (stamp.rows?.[0]?.name == null) {
      // Refuse an unstamped database with relations in *any* user schema,
      // including schemas outside search_path. pg_class is not limited by
      // information_schema's privilege-filtered view of tables.
      const existing = await this.select({select: `SELECT COUNT(*)::int AS n
        FROM pg_class AS c JOIN pg_namespace AS ns ON ns.oid = c.relnamespace
        WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
          AND ns.nspname NOT LIKE 'pg_toast%' AND ns.nspname NOT LIKE 'pg_temp_%'`});
      if (Number(existing.rows?.[0]?.n) !== 0) {
        throw new Error("PostgreSQL database has tables but no OSD schema stamp; use a fresh dedicated database");
      }
      return false;
    }
    const stored = await this.select({select: "SELECT fingerprint FROM osd_schema LIMIT 1"});
    if (stored.rows?.[0]?.fingerprint?.trim() !== wanted) {
      throw new Error(`PostgreSQL schema drift: stored ${stored.rows?.[0]?.fingerprint ?? "missing"}, expected ${wanted}; existing data left intact`);
    }
    return true;
  }

  async stamp(schema) {
    await this.execute('CREATE TABLE osd_schema (fingerprint CHAR(16) NOT NULL)');
    await this.execute(`INSERT INTO osd_schema (fingerprint) VALUES ('${fingerprintOf(schema)}')`);
  }

  // ---------------------------------------------------------------------
  // Parameterised native SQL for the SQLScript relational lowering. Open
  // SQL keeps using the upstream select/insert/update/delete surface.
  // ---------------------------------------------------------------------

  get supportsNative() {
    return true;
  }

  async native({sql, params = [], expect = "rows"}) {
    // Upstream poisons the client after a failed COMMIT because that LUW was
    // lost. The native path is part of the same LUW and must not bypass that
    // fail-stop state.
    this.checkFatal();
    const connection = this.client ?? this.pool;
    if (connection === undefined) throw new Error("PostgreSQL native: database connection not established");
    if (this.trace === true) console.log("native:", sql, params.length ? JSON.stringify(params) : "");
    const request = {text: sql, values: params.map(bindNativeValue)};
    let answer;
    if (this.client === undefined) {
      answer = await connection.query(request);
    } else {
      // PostgreSQL aborts the complete transaction after any statement
      // error. An ABAP caller may catch an AMDP exception and continue its
      // LUW, so fence a native statement exactly as upstream fences Open SQL.
      await this.client.query("SAVEPOINT osd_native");
      try {
        answer = await this.client.query(request);
        await this.client.query("RELEASE SAVEPOINT osd_native");
      } catch (error) {
        await this.client.query("ROLLBACK TO SAVEPOINT osd_native; RELEASE SAVEPOINT osd_native;");
        throw error;
      }
    }
    if (expect === "none") return {rowCount: answer.rowCount};
    const columns = (answer.fields ?? []).map((field) => ({name: field.name, type: field.dataTypeID}));
    const rows = answer.rows ?? [];
    if (expect === "scalar") {
      const first = rows[0];
      return {value: first === undefined ? undefined : first[Object.keys(first)[0]], columns};
    }
    return {rows, columns, rowCount: answer.rowCount ?? rows.length};
  }

  async defineRelation({name = "rel", sql, params = [], materialise}) {
    if (params.length > 0 && materialise === undefined) {
      throw new Error("defineRelation: params are not supported on a definition; materialise it, or bind at use");
    }
    this.relationCount = (this.relationCount ?? 0) + 1;
    const stem = String(name).replace(/[^A-Za-z0-9_]/g, "_").toUpperCase().slice(0, 24);
    const ident = `OSD_${stem}_${this.relationScope}_${this.relationCount}`;
    const handle = {ident, ref: `"${ident}"`,
      kind: materialise === undefined ? "definition" : "materialised", reason: materialise};
    if (materialise === undefined) {
      await this.native({sql: `CREATE VIEW ${handle.ref} AS ${sql}`, expect: "none"});
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
    try {
      await this.native({sql: `DROP ${handle.kind === "definition" ? "VIEW" : "TABLE"} ${handle.ref}`,
        expect: "none"});
    } catch (error) {
      // Idempotent cleanup may ignore only "undefined table/object". A
      // permission, connection or aborted-LUW failure is part of the result.
      if (!["42P01", "42704"].includes(error?.code)) throw error;
    }
  }
}

export function postgresInserts(inserts) {
  // The transpiler currently quotes INSERT column identifiers as SQLite
  // string literals. PostgreSQL needs actual double-quoted identifiers.
  return inserts.map(statement => statement.replace(/^(INSERT INTO \S+ \()([^)]*)\)/i,
    (_all, head, columns) => head + columns.replace(/'([A-Za-z_0-9]+)'/g, (_value, name) => `"${name.toLowerCase()}"`) + ")"));
}
