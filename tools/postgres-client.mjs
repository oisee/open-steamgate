// PostgreSQL connection and first-run seed for the OSD runtime.
// A dedicated database is the isolation boundary; this client uses its public
// schema and never drops or rewrites a pre-existing schema.
import {PostgresDatabaseClient} from "@abaplint/database-pg";
import {fingerprintOf} from "./osd-persist.mjs";

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
}

export function postgresInserts(inserts) {
  // The transpiler currently quotes INSERT column identifiers as SQLite
  // string literals. PostgreSQL needs actual double-quoted identifiers.
  return inserts.map(statement => statement.replace(/^(INSERT INTO \S+ \()([^)]*)\)/i,
    (_all, head, columns) => head + columns.replace(/'([A-Za-z_0-9]+)'/g, (_value, name) => `"${name.toLowerCase()}"`) + ")"));
}
