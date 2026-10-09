// Where the rows live when the process that holds them goes away.
//
// The serving runtime is about to become something that gets recycled: a
// new one boots when activated code has to become live, and the old one
// exits. That is fine for code, which is on disk, and fatal for data,
// which is not: the SQLite here is sql.js, a database in memory, so
// everything a client created would die with the process it was created
// in.
//
// So STG_DB_PATH, which DuckDB already understood, now means the same
// thing for SQLite: this file is where the database is. It is read when a
// runtime boots and written when it exits. Nothing is written while it
// runs, because sql.js has no incremental write and exporting on every
// statement would cost more than the recycle it is protecting.
//
// Without STG_DB_PATH nothing here changes: the database is in memory, the
// seed runs every time, and a test suite is not slowed down by a file.
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync} from "node:fs";
import {dirname} from "node:path";

// The whole-schema stamp remains compatible with old snapshots. The general
// planner also records per-table definitions and preserves incompatible
// application tables individually (docs/db-migrations.md).
const STAMP = "osd_schema";

export function fingerprintOf(schema) {
  const text = Array.isArray(schema) ? schema.join("\n") : String(schema ?? "");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// set once the seed is complete: before that, a stop must not export a
// half-built database over the last good file (the boot can be stopped now,
// tools/osd-serve.mjs); leaving the file as it was is the safe outcome
let seeded = false;

// written after the seed, so it travels with the bytes that are saved
export async function stamp(db, schema) {
  if (databaseFile() === undefined) {
    return undefined;
  }
  const fingerprint = fingerprintOf(schema);
  await db.execute(`CREATE TABLE IF NOT EXISTS ${STAMP} ('fingerprint' NCHAR(16), 'at' NCHAR(32));`);
  await db.execute(`DELETE FROM ${STAMP};`);
  await db.execute(`INSERT INTO ${STAMP} ('fingerprint', 'at') VALUES ('${fingerprint}', '${new Date().toISOString()}');`);
  seeded = true;
  return fingerprint;
}

// SQLite only: the DuckDB client takes the path itself and keeps its own
// file, which it can write to as it goes
export function databaseFile() {
  const path = process.env.STG_DB_PATH;
  // The stamp travels with a saved database **file**, so a backend that has
  // no file has nothing to stamp. duckdb was excluded by name and HANA was
  // not, which is the wrong shape of test: the list of engines that are not
  // a file grows, and the one that is does not. `STG_DB` unset or "file" is
  // the file client; everything else is a server or a memory database.
  //
  // Measured on HANA before fixing it, because the statements below are not
  // merely pointless there, they are refused:
  //   CREATE TABLE IF NOT EXISTS …  -> incorrect syntax near "IF"
  //   INSERT INTO t ('a', 'b') …    -> incorrect syntax near "a"
  // The second is the same defect this tree sent upstream today as
  // abaplint/transpiler#1876: column names in single quotes, which SQLite
  // accepts as identifiers and no other engine does.
  const file = process.env.STG_DB === undefined || process.env.STG_DB === "file";
  if (path === undefined || path === "" || file === false) {
    return undefined;
  }
  return path;
}

/** The file the rows live in, INCLUDING the default one, for a caller that
 *  has to name the database before anything is connected.
 *
 *  `test/start.mjs` had its own copy of this decision and it was wrong in the
 *  way the comment above describes: it read `STG_DB_PATH` and never asked
 *  `STG_DB`. The container sets `STG_DB_PATH` so the rows land on a volume,
 *  so with `STG_DB=hana` the parent seeded HANA -- 82 tables -- and the work
 *  processes opened an empty SQLite file. No error, HTTP 200, healthy, and
 *  every entity set empty.
 *
 *  `STG_DB_PATH` answers "where should a file go", truthfully, and was read
 *  as "which database is this". Same shape as `builtAt` answering "when was
 *  this release assembled" and being read as "what is inside it". So the
 *  decision lives here once, and start.mjs asks rather than deciding. */
export function databasePath(fallback) {
  const path = databaseFile();
  if (path !== undefined) {
    return path;
  }
  const file = process.env.STG_DB === undefined || process.env.STG_DB === "file";
  return file ? fallback : undefined;
}

// true when a snapshot was restored/migrated; false only for a missing or
// empty file. Restored application rows are never seeded over.
export async function loadInto(db, schema) {
  const file = databaseFile();
  if (file === undefined || existsSync(file) === false) {
    await db.connect();
    return false;
  }
  const bytes = readFileSync(file);
  if (bytes.length === 0) {
    await db.connect();
    return false;
  }
  await db.connect(bytes);
  // a file read whole was complete: saving it back is safe from here on
  if (schema === undefined) {
    seeded = true;
    return true;
  }
  const {startupDatabase} = await import(/* webpackIgnore: true */ "./osd-db-migrate.mjs");
  const access = {
    name: "sqlite", execute: (sql) => db.execute(sql),
    query: async (sql) => (await db.select({select: sql})).rows,
    commit: () => db.execute("COMMIT"), rollback: () => db.execute("ROLLBACK"),
  };
  await startupDatabase(access, schema, [], {strict: process.env.STG_DB_STRICT === "1"});
  db.schemaDrift = access.schemaDrift;
  seeded = true;
  return true;
}

export class SchemaDrift extends Error {
  constructor(message) {
    super(message);
    this.code = "SCHEMA_DRIFT";
  }
}

// the bytes to the file, through a temporary name, so a process killed
// mid-write leaves the last good database rather than half of a new one
export function save(db) {
  const file = databaseFile();
  if (file === undefined) {
    return undefined;
  }
  // Native file clients already persist committed rows, including their WAL.
  if (db?.db && db.path === file) return {file, bytes: statSync(file).size};
  const bytes = db?.export?.();
  if (bytes === undefined) {
    return undefined;
  }
  mkdirSync(dirname(file), {recursive: true});
  const temporary = `${file}.writing`;
  writeFileSync(temporary, Buffer.from(bytes));
  renameSync(temporary, file);
  return {file, bytes: bytes.length};
}

// a runtime that is asked to go away writes what it holds first. SIGTERM is
// how a supervisor asks; beforeExit covers a process that runs out of work;
// exit covers one that calls process.exit, which fires neither of the other
// two. Writing is synchronous on purpose, because an exit handler cannot
// wait for anything else.
export function saveWhenAsked(db) {
  if (databaseFile() === undefined) {
    return;
  }
  let saved = false;
  const once = () => {
    if (saved === true || seeded === false) {
      return;
    }
    saved = true;
    try {
      save(db);
    } catch (error) {
      console.error("the database could not be written:", error?.message ?? error);
    }
  };
  process.on("beforeExit", once);
  process.on("exit", once);
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      once();
      process.exit(0);
    });
  }
  return once;
}
