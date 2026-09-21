import {SQLiteDatabaseClient} from "@abaplint/database-sqlite";
import {bootIdentity} from "../tools/osd-identity.mjs";
import {installTrim} from "../tools/sql-literals.mjs";
import {installSqlTrace, fileSink} from "../tools/osd-sql-trace.mjs";
import {batchInserts} from "../tools/osd-batch-inserts.mjs";
import {TraceRing, TraceDestination} from "../tools/osd-sql-trace-buffer.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";

/** The trace a running system holds, for the ST05-shaped screen to read
 *  (backlog G.10). It is off until the screen turns it on, and the wrapper
 *  costs nothing while it is. */
export const traceRing = new TraceRing();

/** `STG_SQL_TRACE=<file.ndjson>` records every statement the chosen client is
 *  asked for -- the second sieve of backlog W.1, and the cheap half of O.1.
 *
 *  Here rather than in a client, because all six paths below choose a
 *  different client and every one of them has to be traceable: a tracer
 *  written into one client is a tracer the other five do not have. This file
 *  is the transpiler's `options.setup`, so it is the one place the server,
 *  the unit run and the browser preview all pass through. */
function traced(db) {
  const file = globalThis.process?.env?.STG_SQL_TRACE;
  const toFile = file === undefined || file === "" ? undefined : fileSink(file);
  // Installed whether or not anything is listening, because the screen turns
  // it on at runtime; `enabled` keeps that free until something does.
  return installSqlTrace(db, (entry) => {
    toFile?.(entry);
    traceRing.record(entry);
  }, {enabled: () => toFile !== undefined || traceRing.on === true});
}

/** the destination the ST05 screen calls, the same shape as AMDP's */
export function installTraceDestination(abap) {
  abap.context.RFCDestinations ??= {};
  abap.context.RFCDestinations["SQLTRACE"] = new TraceDestination(traceRing);
}

/**
 * The destination the editor screen calls (backlog G.8), and the third user
 * of this seam rather than a third seam.
 *
 * The store is opened on the first call, not here: it indexes the tree and
 * parses it with abaplint, which is seconds, and most processes that install
 * it never get a request for it. Where there is no tree at all -- the browser
 * preview, a compiled binary beside no checkout -- opening it fails and the
 * failure becomes the sentence the screen shows, which is the honest answer
 * and not an empty object list.
 */
export function installStoreDestination(abap, options = {}) {
  abap.context.RFCDestinations ??= {};
  abap.context.RFCDestinations["STORE"] = new StoreDestination({
    // imported inside the opener, never at the top of this file: the store
    // pulls in abaplint and node:fs, and this module is bundled into the
    // service worker of the browser preview. A static import would put the
    // whole parser in a page that can never use it.
    store: options.store ?? (async () => {
      if (globalThis.__stgPreview !== undefined) {
        throw new Error("the browser preview serves a built system: there is no source tree in a page");
      }
      const root = globalThis.process?.cwd?.();
      const {existsSync} = await import("node:fs");
      const {join} = await import("node:path");
      if (root === undefined || existsSync(join(root, "abap_transpile.json")) === false) {
        throw new Error(`no tree at ${root ?? "this process"}: abap_transpile.json is not there`);
      }
      const {ObjectStore} = await import("../tools/osd-store.mjs");
      return new ObjectStore({root});
    }),
    ...options,
  });
}

// Called by the transpiled runtime before anything runs (abap_transpile.json
// options.setup). Same shape as every open-abap repo: one in-memory DB,
// schema from the DDIC in src/ + libs, seed rows from data/*.tabu.json.
// STG_DB=duckdb swaps SQLite for DuckDB (tools/duckdb-client.mjs).
export async function setup(abap, schemas, insert) {
  let db;
  // The transpiler hands over the object directory and the sources one row
  // per statement -- 1542 INSERTs into TADIR and 907 into REPOSRC, measured
  // on a real unit run after the seed itself was batched (e088c4d). A
  // statement costs its parse, so consecutive rows of one shape are merged
  // into one. Here rather than in each branch below: all six of them execute
  // this same array.
  insert = batchInserts(insert);
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
    db = installTrim(new SQLiteDatabaseClient());
    abap.context.databaseConnections["DEFAULT"] = traced(db);
    await db.connect(preview.stored);
    if (preview.stored === undefined) {
      await db.execute(schemas.sqlite);
      await db.execute(insert);
      await db.execute(preview.seed);
    }
    preview.db = db;
    // The AMDP destination belongs here too. Three lines below the early
    // return, the non-preview path says "it is installed whatever the
    // database is, because the failure a developer needs is 'no HANA to run
    // this in', not 'unknown destination'" -- and the preview returned before
    // reaching it, so in the browser there was no destination at all. A
    // stated intention that the code does not honour is worse than no
    // intention: the AMDP tile asked an honest question and got a crash page
    // (E.5, 2026-09-19).
    const {AmdpDestination: PreviewAmdp} = await import("../tools/amdp-destination.mjs");
    abap.context.RFCDestinations ??= {};
    abap.context.RFCDestinations["AMDP"] = new PreviewAmdp({});
    installTraceDestination(abap);
    installStoreDestination(abap);
    return;
  }
  const {seedStatements} = await import("./seed.mjs");
  // CALL FUNCTION ... DESTINATION: .local/rfc-destinations.json says which
  // name is local, replay, live or record (tools/rfc-replay.mjs); without
  // it 'NONE' and '' run here and any other name replays STG_RFC_CAPTURE
  const {installRfcDestinations} = await import("../tools/rfc-replay.mjs");
  await installRfcDestinations(abap, {trace: process.env.STG_RFC_TRACE === "1"});
  // AMDP: a method whose body is SQLScript has been rewritten by
  // tools/amdp-gen.mjs into CALL FUNCTION ... DESTINATION 'AMDP', and this is
  // where that destination is answered (docs/amdp-in-hana.md). It is
  // installed whatever the database is, because the failure a developer needs
  // is "no HANA to run this in", not "unknown destination".
  const {AmdpDestination} = await import("../tools/amdp-destination.mjs");
  abap.context.RFCDestinations["AMDP"] = new AmdpDestination({trace: process.env.STG_AMDP_TRACE === "1"});
  installTraceDestination(abap);
  installStoreDestination(abap);
  if (process.env.STG_DB === "postgres") {
    // The preview returns above and has no PostgreSQL socket. Keep this
    // server-only driver out of its service-worker bundle (as rfc-live does).
    const {OsdPostgresClient, postgresInserts} = await import(/* webpackIgnore: true */ "../tools/postgres-client.mjs");
    db = new OsdPostgresClient({trace: process.env.STG_DB_TRACE === "1"});
    // The upstream client creates a pool before it opens a socket. Verify a
    // real query before publishing the backend's identity to ABAP and status.
    await db.connect();
    abap.context.databaseConnections["DEFAULT"] = traced(db);
    abap.builtin.sy.get().dbsys?.set(db.name);
    if (await db.hasSchema(schemas.pg)) return;
    await db.beginTransaction();
    try {
      await db.execute(schemas.pg);
      await db.execute(postgresInserts(insert));
      await db.execute(seedStatements());
      await loadScaledData(db, "postgres");
      await db.stamp(schemas.pg);
      await db.commit();
    } catch (error) {
      await db.rollback();
      throw error;
    }
    return;
  }
  // STG_DB=hana: a real HANA, which is the mode the AMDP work runs in -- the
  // procedure and the tables are then in one database and nothing has to be
  // mirrored (docs/amdp-in-hana.md, backlog B.19). Never a default: the cost
  // is per statement and it is 52x on a single-row SELECT, measured in
  // docs/db-backends.md. HANA_SCHEMA picks the schema, default OSD, and it is
  // kept between runs unless STG_DB_FRESH=1.
  if (process.env.STG_DB === "hana") {
    const {HanaDatabaseClient, hanaSchema, hanaInserts} = await import("../tools/hana-client.mjs");
    db = new HanaDatabaseClient({trace: process.env.STG_DB_TRACE === "1"});
    abap.context.databaseConnections["DEFAULT"] = traced(db);
    await db.connect();
    // Seed once per run, not once per connection. A run opens more than one
    // (the database client, and the AMDP destination holds its own), and both
    // used to build the whole schema. The connection that made the schema
    // fresh is the one that seeds it; every other finds it there.
    if (await db.hasSchema() && db.droppedSchema !== true) {
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
    abap.context.databaseConnections["DEFAULT"] = traced(db);
    await db.connect();
    if (process.env.STG_DB_PATH && await db.hasSchema()) {
      // A persistent database keeps its business rows, but the generated
      // repository catalog must follow the running generation. Otherwise a
      // new BSP page is in the registry while its WWWPARAMS object is absent.
      await upsertGeneratedMetadata(db, insert);
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
    const {FileSqliteClient, DEFAULT_DATABASE, BASE_DIR, setAsideDatabase} = await import("../tools/sqlite-file-client.mjs");
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
    abap.context.databaseConnections["DEFAULT"] = traced(db);
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
      // the -wal and the -shm go with it: a shared-memory index left behind
      // under the old name is what a later runtime maps and dies on
      setAsideDatabase(path, aside);
      console.log(`${said}: moved to ${aside}, starting with an empty database`);
      db = new FileSqliteClient({trace: process.env.STG_DB_TRACE === "1", path});
      abap.context.databaseConnections["DEFAULT"] = traced(db);
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
  db = installTrim(new SQLiteDatabaseClient());
  abap.context.databaseConnections["DEFAULT"] = traced(db);
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

/** Refresh generation-owned repository rows without clearing user tables.
 * DuckDB's persistent mode previously skipped the generated INSERTs entirely
 * after the first boot. Only the object catalog is upserted: trip facts and
 * other application data remain untouched. */
export async function upsertGeneratedMetadata(db, insert) {
  const statements = Array.isArray(insert) ? insert : String(insert ?? "").split("\n").filter((s) => s.trim() !== "");
  const owned = statements
    .filter((s) => /^INSERT INTO "(?:tadir|wwwparams)"/i.test(s.trim()))
    .map((s) => s.replace(/^INSERT INTO/i, "INSERT OR REPLACE INTO"));
  if (owned.length === 0) return;
  await db.execute(owned);
  await db.commit();
}
