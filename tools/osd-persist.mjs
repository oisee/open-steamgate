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
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";

// The one table OSD owns in its own database: which schema the rows in this
// file were made for. Source and data version on different axes, git for the
// one and this file for the other, and a file made for one branch's DDIC
// opened by another branch's code would otherwise come up silently with the
// wrong tables and serve rows the running code does not describe.
//
// It is a compatibility check and nothing more. Nothing compares it between
// instances, nothing promotes it, and the answer to a mismatch is to build
// this instance's data again, never to fetch data from somewhere else.
const STAMP = "osd_schema";

export function fingerprintOf(schema) {
  const text = Array.isArray(schema) ? schema.join("\n") : String(schema ?? "");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function stampOf(db) {
  try {
    const answer = await db.select({select: `SELECT fingerprint FROM ${STAMP} LIMIT 1`});
    return answer?.rows?.[0]?.fingerprint;
  } catch {
    // no such table: a file from before this existed, which is a file whose
    // schema nobody recorded and therefore nobody can trust
    return undefined;
  }
}

// written after the seed, so it travels with the bytes that are saved
export async function stamp(db, schema) {
  if (databaseFile() === undefined) {
    return undefined;
  }
  const fingerprint = fingerprintOf(schema);
  await db.execute(`CREATE TABLE IF NOT EXISTS ${STAMP} ('fingerprint' NCHAR(16), 'at' NCHAR(32));`);
  await db.execute(`DELETE FROM ${STAMP};`);
  await db.execute(`INSERT INTO ${STAMP} ('fingerprint', 'at') VALUES ('${fingerprint}', '${new Date().toISOString()}');`);
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

// true when the database came back from the file and the caller should not
// seed over it; false when the caller has to build it, which is a file that
// never existed, an empty one, or one made for a different schema
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
  if (schema === undefined) {
    return true;
  }
  const wanted = fingerprintOf(schema);
  const found = await stampOf(db);
  if (found === wanted) {
    return true;
  }
  // the rows in this file were made for other tables. Saying so is the
  // point: silently serving them is how a client reads data the running
  // code does not describe.
  //
  // What to do about it is a knob, and the default is to rebuild, because
  // rows that do not fit the running code cannot be served whatever we
  // decide, so refusing only leaves an instance stuck. STG_DB_STRICT=1 is
  // for data worth looking at before it is thrown away: then nothing is
  // touched and the human chooses. Never silent either way.
  const said = `${file} was made for schema ${found ?? "nobody recorded which"} and this runtime generates ${wanted}`;
  if (process.env.STG_DB_STRICT === "1") {
    throw new SchemaDrift(`${said}: refusing to touch it (STG_DB_STRICT=1). Move it aside, or unset STG_DB_STRICT to rebuild.`);
  }
  console.log(`${said}: starting with an empty database`);
  await db.disconnect();
  await db.connect();
  return false;
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
    if (saved === true) {
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
