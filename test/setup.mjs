import {SQLiteDatabaseClient} from "@abaplint/database-sqlite";

// Called by the transpiled runtime before anything runs (abap_transpile.json
// options.setup). Same shape as every open-abap repo: one in-memory DB,
// schema from the DDIC in src/ + libs, seed rows from data/*.tabu.json.
// STG_DB=duckdb swaps SQLite for DuckDB (tools/duckdb-client.mjs).
export async function setup(abap, schemas, insert) {
  let db;
  // the browser preview (web/preview-backend.mjs): seed rows come from the
  // bundle, the database from cache storage when there is one
  const preview = globalThis.__stgPreview;
  if (preview !== undefined) {
    preview.schemas = schemas;
    preview.insert = insert;
    db = new SQLiteDatabaseClient();
    abap.context.databaseConnections["DEFAULT"] = db;
    await db.connect(preview.stored);
    if (preview.stored === undefined) {
      await db.execute(schemas.sqlite);
      await db.execute(insert);
      await db.execute(preview.seed);
    }
    preview.db = db;
    return;
  }
  const {seedStatements} = await import("./seed.mjs");
  // CALL FUNCTION ... DESTINATION: .local/rfc-destinations.json says which
  // name is local, replay, live or record (tools/rfc-replay.mjs); without
  // it 'NONE' and '' run here and any other name replays STG_RFC_CAPTURE
  const {installRfcDestinations} = await import("../tools/rfc-replay.mjs");
  await installRfcDestinations(abap, {trace: process.env.STG_RFC_TRACE === "1"});
  if (process.env.STG_DB === "duckdb") {
    const {DuckDBDatabaseClient, duckdbSchema, duckdbInserts} = await import("../tools/duckdb-client.mjs");
    // STG_DB_PATH=some.duckdb keeps the data between runs
    db = new DuckDBDatabaseClient({trace: process.env.STG_DB_TRACE === "1", path: process.env.STG_DB_PATH ?? ":memory:"});
    abap.context.databaseConnections["DEFAULT"] = db;
    await db.connect();
    if (process.env.STG_DB_PATH && await db.hasSchema()) {
      return;
    }
    await db.execute(duckdbSchema(schemas));
    await db.execute(duckdbInserts(insert));
    await db.execute(seedStatements());
    await loadScaledData(db, "duckdb");
    await db.commit();
    return;
  }
  // STG_DB=file: a real SQLite file, written while the process runs, WAL
  // (tools/sqlite-file-client.mjs). The rows survive a crash and a recycle,
  // and a second connection can read them. The default path keeps them
  // beside the tree, out of git.
  if (process.env.STG_DB === "file") {
    const {FileSqliteClient, DEFAULT_DATABASE} = await import("../tools/sqlite-file-client.mjs");
    const {fingerprintOf, SchemaDrift} = await import("../tools/osd-persist.mjs");
    const {existsSync, renameSync} = await import("node:fs");
    const path = process.env.STG_DB_PATH ?? DEFAULT_DATABASE;
    db = new FileSqliteClient({trace: process.env.STG_DB_TRACE === "1", path});
    abap.context.databaseConnections["DEFAULT"] = db;
    await db.connect();
    const wanted = fingerprintOf(schemas.sqlite);
    const found = await db.stampedSchema();
    if (found === wanted) {
      return; // the rows are already there, made for this DDIC
    }
    if (found !== undefined || existsSync(path) && (await db.query("SELECT COUNT(*) AS n FROM sqlite_master"))[0]?.n > 0) {
      // a file made for another DDIC, or one nobody stamped: not this
      // instance's data. Moved aside with the schema it was made for in
      // its name, never dropped — the rows may be somebody's
      const said = `${path} was made for schema ${found ?? "nobody recorded which"} and this runtime generates ${wanted}`;
      if (process.env.STG_DB_STRICT === "1") {
        throw new SchemaDrift(`${said}: refusing to touch it (STG_DB_STRICT=1)`);
      }
      await db.disconnect();
      const aside = `${path}.${found ?? "unstamped"}.drift`;
      renameSync(path, aside);
      console.log(`${said}: moved to ${aside}, starting with an empty database`);
      db = new FileSqliteClient({trace: process.env.STG_DB_TRACE === "1", path});
      abap.context.databaseConnections["DEFAULT"] = db;
      await db.connect();
    }
    await db.execute(schemas.sqlite);
    await db.execute(insert);
    await db.execute(seedStatements());
    await loadScaledData(db, "sqlite");
    await db.stamp(schemas.sqlite);
    await db.commit();
    return;
  }
  db = new SQLiteDatabaseClient();
  abap.context.databaseConnections["DEFAULT"] = db;
  // STG_DB_PATH keeps the rows between runs for SQLite too, which is what
  // a runtime that gets recycled needs: it is read here and written when
  // this process is asked to go away (tools/osd-persist.mjs). Without it
  // the database is in memory and the seed runs every time, as before.
  const {loadInto, saveWhenAsked, stamp} = await import("../tools/osd-persist.mjs");
  // a file made for a different DDIC is not this instance's data, so it is
  // said out loud and built again rather than served as if it fitted
  const restored = await loadInto(db, schemas.sqlite);
  saveWhenAsked(db);
  if (restored === true) {
    return;
  }
  await db.execute(schemas.sqlite);
  await db.execute(insert);
  await db.execute(seedStatements());
  await loadScaledData(db, "sqlite");
  await stamp(db, schemas.sqlite);
}

// STG_DATA_SCALE=<rows> adds that many synthetic flight facts (tools/gen-data.mjs)
// for the analytical cube; the seeds stay as they are
async function loadScaledData(db, kind) {
  const scale = Number(process.env.STG_DATA_SCALE ?? 0);
  if (scale > 0) {
    const {loadFlightFacts} = await import("../tools/gen-data.mjs");
    await loadFlightFacts(db, scale, kind);
  }
}
