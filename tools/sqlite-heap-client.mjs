import {SQLiteDatabaseClient as UpstreamClient} from "@abaplint/database-sqlite";

// ANOMALY-2026-10-03-sqlite-execute-stack: sql.js run(string) copies SQL
// onto the fixed WASM stack. exec(string) allocates it on the growable heap
// and frees it in finally. Keep this seam shared by Node and the preview
// until database-sqlite ships the equivalent fix.
export class SQLiteDatabaseClient extends UpstreamClient {
  async execute(sql) {
    if (typeof sql === "string") {
      if (sql !== "") this.sqlite.exec(sql);
    } else {
      for (const statement of sql) await this.execute(statement);
    }
  }
}
