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
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";

// SQLite only: the DuckDB client takes the path itself and keeps its own
// file, which it can write to as it goes
export function databaseFile() {
  const path = process.env.STG_DB_PATH;
  if (path === undefined || path === "" || process.env.STG_DB === "duckdb") {
    return undefined;
  }
  return path;
}

// true when the database came back from the file and the caller should not
// seed over it; false when this is a database that has never existed
export async function loadInto(db) {
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
  return true;
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
