import {SQLiteDatabaseClient as UpstreamClient} from "@abaplint/database-sqlite";
import {setupSqliteConnection} from "./sqlite-connection.mjs";

// ANOMALY-2026-10-03-sqlite-execute-stack: sql.js run(string) copies SQL
// onto the fixed WASM stack. exec(string) allocates it on the growable heap
// and frees it in finally. Keep this seam shared by Node and the preview
// until database-sqlite ships the equivalent fix.
export class SQLiteDatabaseClient extends UpstreamClient {
  async connect(data) {
    await super.connect(data);
    setupSqliteConnection(this.sqlite);
  }

  export() {
    const data = super.export();
    if (this.sqlite) setupSqliteConnection(this.sqlite);
    return data;
  }

  async execute(sql) {
    if (typeof sql === "string") {
      if (sql !== "") this.sqlite.exec(sql);
    } else {
      for (const statement of sql) await this.execute(statement);
    }
  }
}
