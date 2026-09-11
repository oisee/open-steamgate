import {SQLiteDatabaseClient} from "@abaplint/database-sqlite";
import {seedStatements} from "./seed.mjs";

// Called by the transpiled runtime before anything runs (abap_transpile.json
// options.setup). Same shape as every open-abap repo: one in-memory SQLite,
// schema from the DDIC in src/ + libs, seed rows from data/*.tabu.json.
export async function setup(abap, schemas, insert) {
  const db = new SQLiteDatabaseClient();
  abap.context.databaseConnections["DEFAULT"] = db;
  await db.connect();
  await db.execute(schemas.sqlite);
  await db.execute(insert);
  await db.execute(seedStatements());
}
