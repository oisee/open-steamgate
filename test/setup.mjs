import {SQLiteDatabaseClient} from "@abaplint/database-sqlite";
import {bootIdentity} from "../tools/osd-identity.mjs";

// Called by the transpiled runtime before anything runs (abap_transpile.json
// options.setup). Same shape as every open-abap repo: one in-memory DB,
// schema from the DDIC in src/ + libs, seed rows from data/*.tabu.json.
// STG_DB=duckdb swaps SQLite for DuckDB (tools/duckdb-client.mjs).
export async function setup(abap, schemas, insert) {
  let db;
  // the browser preview (web/preview-backend.mjs): seed rows come from the
  // bundle, the database from cache storage when there is one
  const preview = globalThis.__stgPreview;
  // Who this system is, before a line of ABAP runs: sy-sysid, sy-mandt and
  // sy-uname come from tools/osd-identity.mjs, which the status snapshot and
  // the ADT façade read too, so the three cannot drift apart (backlog G.1b).
  // In the browser there is no environment; the build wrote the id into the
  // bundle and the backend hands it over here.
  bootIdentity(abap, preview?.env ?? globalThis.process?.env ?? {});
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
  // STG_DB=hana: a real HANA, which is the mode the AMDP work runs in -- the
  // procedure and the tables are then in one database and nothing has to be
  // mirrored (docs/amdp-in-hana.md, backlog B.19). Never a default: the cost
  // is per statement and it is 52x on a single-row SELECT, measured in
  // docs/db-backends.md. HANA_SCHEMA picks the schema, default OSD, and it is
  // kept between runs unless STG_DB_FRESH=1.
  if (process.env.STG_DB === "hana") {
    const {HanaDatabaseClient, hanaSchema, hanaInserts} = await import("../tools/hana-client.mjs");
    db = new HanaDatabaseClient({trace: process.env.STG_DB_TRACE === "1"});
    abap.context.databaseConnections["DEFAULT"] = db;
    await db.connect();
    if (process.env.STG_DB_FRESH !== "1" && await db.hasSchema()) {
      return;
    }
    await db.execute(hanaSchema(schemas));
    await db.execute(hanaInserts(insert));
    await db.execute(seedStatements());
    await loadScaledData(db, "hana");
    await db.commit();
    return;
  }
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
    const {FileSqliteClient, DEFAULT_DATABASE, BASE_DIR} = await import("../tools/sqlite-file-client.mjs");
    const {fingerprintOf, SchemaDrift} = await import("../tools/osd-persist.mjs");
    const {existsSync, renameSync, copyFileSync, mkdirSync} = await import("node:fs");
    const {join, dirname} = await import("node:path");
    const path = process.env.STG_DB_PATH ?? DEFAULT_DATABASE;
    const wanted = fingerprintOf(schemas.sqlite);
    // A base image: this DDIC's schema and mandatory rows, seeded once and
    // kept under .local/db/base/<hash>.sqlite. A database that does not exist
    // yet is a copy of it — milliseconds, and the same bytes every time —
    // and the first instance of a new DDIC seeds and leaves the image behind
    // for the next. This is what makes twenty runtimes over twenty files
    // cheap: each is a copy, and nobody seeds twice.
    //
    // The image is named by the schema *and* the rows that went into it: the
    // generation's mandatory rows (the wwwparams of every SMW0 object) and
    // the seed. Named by the schema alone, an image made before a pack
    // brought a new media object was copied for every later database, and
    // the object was in the generation and not in the table (B.13,
    // 2026-09-17). The stamp inside the file stays the schema's, which is
    // what drift means.
    const seeded = seedStatements();
    const imageOf = fingerprintOf([schemas.sqlite, ...insert, ...seeded]);
    const base = join(BASE_DIR, `${imageOf}.sqlite`);
    if (!existsSync(path) && existsSync(base)) {
      mkdirSync(dirname(path), {recursive: true});
      copyFileSync(base, path);
    }
    db = new FileSqliteClient({trace: process.env.STG_DB_TRACE === "1", path});
    abap.context.databaseConnections["DEFAULT"] = db;
    await db.connect();
    const found = await db.stampedSchema();
    if (found === wanted) {
      // the rows are already there, made for this DDIC. The tables the
      // generation writes at start (wwwparams: which SMW0 objects exist and
      // what they are called) are the generation's, not the user's, so they
      // follow it: an object a pack added since this file was made is put
      // in, one the pack dropped is taken out.
      await refreshGenerated(db, insert);
      return;
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
    await db.execute(seeded);
    await loadScaledData(db, "sqlite");
    await db.stamp(schemas.sqlite);
    await db.commit();
    // the image for the next instance, unless scaled data made this one a
    // special case rather than the mandatory rows
    if (!existsSync(base) && !(Number(process.env.STG_DATA_SCALE ?? 0) > 0)) {
      try {
        db.fork(base);
      } catch (error) {
        console.error(`the base image could not be written: ${error?.message ?? error}`);
      }
    }
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

// The tables the generation's own INSERTs fill are rewritten from the
// generation on every boot over an existing file: delete what is there for
// each of those tables, insert what the generation says. Nothing else in the
// file is touched.
async function refreshGenerated(db, insert) {
  const statements = Array.isArray(insert) ? insert : String(insert ?? "").split("\n").filter((s) => s.trim() !== "");
  const tables = new Set();
  for (const s of statements) {
    const m = /^INSERT INTO "([^"]+)"/i.exec(s.trim());
    if (m) {
      tables.add(m[1]);
    }
  }
  if (tables.size === 0) {
    return;
  }
  for (const table of tables) {
    await db.execute(`DELETE FROM "${table}";`);
  }
  await db.execute(statements.filter((s) => /^INSERT INTO "/i.test(s.trim())));
  await db.commit();
}
