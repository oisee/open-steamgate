import {SQLiteDatabaseClient} from "@abaplint/database-sqlite";
import {seedStatements} from "./seed.mjs";

// Called by the transpiled runtime before anything runs (abap_transpile.json
// options.setup). Same shape as every open-abap repo: one in-memory DB,
// schema from the DDIC in src/ + libs, seed rows from data/*.tabu.json.
// STG_DB=duckdb swaps SQLite for DuckDB (tools/duckdb-client.mjs).
export async function setup(abap, schemas, insert) {
  let db;
  if (process.env.STG_DB === "duckdb") {
    const {DuckDBDatabaseClient, duckdbSchema, duckdbInserts} = await import("../tools/duckdb-client.mjs");
    db = new DuckDBDatabaseClient({trace: process.env.STG_DB_TRACE === "1"});
    abap.context.databaseConnections["DEFAULT"] = db;
    await db.connect();
    await db.execute(duckdbSchema(schemas));
    await db.execute(duckdbInserts(insert));
    await db.execute(seedStatements());
    return;
  }
  db = new SQLiteDatabaseClient();
  abap.context.databaseConnections["DEFAULT"] = db;
  await db.connect();
  await db.execute(schemas.sqlite);
  await db.execute(insert);
  await db.execute(seedStatements());
}
