// A transpiler DatabaseClient over a real SQLite file — the rows on disk
// while the process runs, not exported when it exits.
//
// The shape is @abaplint/database-sqlite's to the letter: the same SQL
// rewrites, the same LUW (a modifying statement opens the transaction,
// COMMIT WORK and ROLLBACK WORK end it), subrc 4 on a refused statement,
// changes() for dbcnt. What differs is underneath: node:sqlite (Node's
// own binding, no native module to install) over a file in WAL mode, so a
// write is on disk at COMMIT, a crash loses nothing committed, and a
// second connection — a data preview, a fork about to be taken — reads
// the last committed state without blocking the writer.
//
// This is B4 of docs/generations.md. sql.js stays for the in-memory case
// and the browser; DuckDB stays where it is. Same eleven methods, so
// nothing above the seam knows which of the three it is talking to.
import {DatabaseSync} from "node:sqlite";
import {mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {fingerprintOf} from "./osd-persist.mjs";

const STAMP = "osd_schema";

function rewriteSelect(select, primaryKey) {
  let s = select.replace(/ UP TO (\d+) ROWS(.*)/i, "$2 LIMIT $1");
  s = primaryKey
    ? s.replace(/ ORDER BY PRIMARY KEY/i, " ORDER BY " + primaryKey.join(", "))
    : s.replace(/ ORDER BY PRIMARY KEY/i, "");
  s = s.replace(/ ASCENDING/ig, " ASC").replace(/ DESCENDING/ig, " DESC");
  s = s.replace(/~/g, ".").replace(/ LIMIT 0/g, ""); // the same hack the reference carries
  s = s.replace(/\bLEFT\s*\(\s*(.+?)\s*,\s*(\d+)\s*\)/ig, "substr($1, 1, $2)");
  s = s.replace(/\bRIGHT\s*\(\s*(.+?)\s*,\s*(\d+)\s*\)/ig, "substr($1, -$2)");
  return s;
}

// node:sqlite hands integers back as numbers (or bigints past 2^53) and
// everything else as the text the schema stores; the runtime wants numbers
function plain(row) {
  for (const k of Object.keys(row)) {
    if (typeof row[k] === "bigint") {
      row[k] = Number(row[k]);
    }
  }
  return row;
}

export class FileSqliteClient {
  constructor(input = {}) {
    this.name = "sqlite";
    this.path = input.path ?? ":memory:";
    this.readOnly = input.readOnly === true;
    this.trace = input.trace === true;
    this.db = undefined;
    this.inTransaction = false;
  }

  async connect() {
    if (this.path !== ":memory:") {
      mkdirSync(dirname(this.path), {recursive: true});
    }
    this.db = new DatabaseSync(this.path, {readOnly: this.readOnly});
    if (this.path !== ":memory:" && !this.readOnly) {
      // WAL: readers do not block the writer and see the last commit;
      // NORMAL: durable at checkpoint, which is what a local system wants
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
    }
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (globalThis.abap?.context?.databaseConnections?.DEFAULT === this) {
      globalThis.abap.builtin.sy.get().dbsys?.set(this.name);
    }
  }

  async disconnect() {
    await this.commit();
    this.db?.close();
    this.db = undefined;
  }

  async execute(sql) {
    if (Array.isArray(sql)) {
      for (const s of sql) {
        await this.execute(s);
      }
      return;
    }
    if (sql === "") {
      return;
    }
    if (this.trace) {
      console.log(sql);
    }
    this.db.exec(sql);
  }

  async beginTransaction() {
    if (this.inTransaction) {
      return;
    }
    this.db.exec("BEGIN TRANSACTION");
    this.inTransaction = true;
  }

  async commit() {
    this.#end("COMMIT");
  }

  async rollback() {
    this.#end("ROLLBACK");
  }

  #end(sql) {
    if (!this.inTransaction) {
      return;
    }
    this.db.exec(sql);
    this.inTransaction = false;
  }

  #changes(sql) {
    if (this.trace) {
      console.log(sql);
    }
    return Number(this.db.prepare(sql).run().changes ?? 0);
  }

  async delete(options) {
    await this.beginTransaction();
    let sql = `DELETE FROM ${options.table}`;
    if (options.where !== "") {
      sql += ` WHERE ${options.where}`;
    }
    try {
      const dbcnt = this.#changes(sql);
      return {subrc: dbcnt === 0 ? 4 : 0, dbcnt};
    } catch {
      return {subrc: 4, dbcnt: 0};
    }
  }

  async update(options) {
    await this.beginTransaction();
    const sql = `UPDATE ${options.table} SET ${options.set.join(", ")} WHERE ${options.where}`;
    try {
      const dbcnt = this.#changes(sql);
      return {subrc: dbcnt === 0 ? 4 : 0, dbcnt};
    } catch {
      return {subrc: 4, dbcnt: 0};
    }
  }

  async insert(options) {
    await this.beginTransaction();
    const sql = `INSERT INTO ${options.table} (${options.columns.map((c) => "'" + c + "'").join(",")}) VALUES (${options.values.join(",")})`;
    try {
      this.#changes(sql);
      return {subrc: 0, dbcnt: 1};
    } catch (error) {
      if (this.trace) {
        console.dir(error);
      }
      return {subrc: 4, dbcnt: 0}; // a UNIQUE constraint, as the reference answers it
    }
  }

  async query(sql) {
    if (this.trace) {
      console.log(sql);
    }
    try {
      return this.db.prepare(sql).all().map(plain);
    } catch (error) {
      if (globalThis.abap?.Classes?.["CX_SY_DYNAMIC_OSQL_SEMANTICS"] !== undefined) {
        throw await new globalThis.abap.Classes["CX_SY_DYNAMIC_OSQL_SEMANTICS"]().constructor_({sqlmsg: error.message || ""});
      }
      throw error;
    }
  }

  async select(options) {
    options.select = rewriteSelect(options.select, options.primaryKey);
    return {rows: await this.query(options.select)};
  }

  async openCursor(options) {
    const statement = this.db.prepare(rewriteSelect(options.select, options.primaryKey));
    const iterator = statement.iterate();
    let done = false;
    return {
      fetchNextCursor: async (packageSize) => {
        const rows = [];
        while (!done && rows.length < packageSize) {
          const next = iterator.next();
          if (next.done) {
            done = true;
            break;
          }
          rows.push(plain(next.value));
        }
        return {rows};
      },
      closeCursor: async () => {
        done = true;
        iterator.return?.();
      },
    };
  }

  // The stamp: which DDIC these rows were made for. The same table and the
  // same fingerprint tools/osd-persist.mjs writes into an exported file, so
  // the two kinds of file say the same thing about themselves.
  async stampedSchema() {
    try {
      return this.db.prepare(`SELECT fingerprint FROM ${STAMP} LIMIT 1`).get()?.fingerprint;
    } catch {
      return undefined; // no such table: nobody recorded a schema
    }
  }

  async stamp(schema) {
    const fingerprint = fingerprintOf(schema);
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${STAMP} ('fingerprint' NCHAR(16), 'at' NCHAR(32));`);
    this.db.exec(`DELETE FROM ${STAMP};`);
    this.db.exec(`INSERT INTO ${STAMP} ('fingerprint', 'at') VALUES ('${fingerprint}', '${new Date().toISOString()}');`);
    return fingerprint;
  }
}
