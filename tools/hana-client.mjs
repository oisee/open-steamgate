// OSD on a real HANA: the eleven-method DatabaseClient of the runtime seam
// (docs/db-backends.md), over the npm driver `hdb`.
//
// Why this exists, decided 2026-09-18: HANA is the mode you switch into when
// the work is AMDP. The procedure and the tables are then in one database, so
// nothing has to be mirrored, and `sy-dbsys` says HDB the way a real system
// does. It is a mode and not a default, because the cost is per statement --
// measured against SQLite in this process, a single-row SELECT is 52x and an
// INSERT 146x, while a 200-row SELECT is only 3.8x. Set-wise ABAP ports
// nearly free; row-at-a-time ABAP does not.
//
// Three things cost work when DuckDB was added, and here two of them are
// cheaper, all measured rather than assumed:
//
//   DDL         free. HANA takes the PostgreSQL schema the transpiler already
//               writes, unchanged -- all 77 CREATE TABLE of this tree.
//   blanks      the same problem DuckDB had. ABAP CHAR is blank-padded and the
//               runtime pads its literals; HANA neither pads nor ignores the
//               padding, so `WHERE K = 'A         '` finds nothing where SQLite
//               (NCHAR ... COLLATE RTRIM) finds the row. The literals are
//               trimmed here, quote-aware, exactly as in the DuckDB client.
//   savepoints  not needed. The runtime expects a failed statement to leave the
//               transaction usable; DuckDB aborts it and our client there
//               replays the LUW. HANA behaves as the runtime expects -- a
//               duplicate-key INSERT is refused and the next INSERT is
//               accepted -- so there is no replay machinery at all.
//
// One prerequisite that is easy to miss: the session must have autocommit off,
// or COMMIT and ROLLBACK mean nothing.
import {createRequire} from "node:module";
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const require = createRequire(import.meta.url);

/** ABAP pads its CHAR literals; HANA compares the padding. Trim inside quotes
 *  only, and leave an escaped quote ('') alone. */
function trimLiterals(sql) {
  return sql.replace(/'((?:[^']|'')*)'/g, (m, inner) => "'" + inner.replace(/ +$/, "") + "'");
}

/** Every identifier this client sends goes to HANA quoted in UPPER case.
 *
 *  The schema is created that way (see hanaSchema), and it has to be, because
 *  a column called `cross` is a reserved word and cannot be created unquoted.
 *  The SQL reaching the client comes in two shapes: most references are
 *  written **unquoted and lower case**, which HANA folds to upper by itself
 *  and which therefore already match, and some arrive **quoted and lower
 *  case**, like `INSERT INTO "cross" ("type", ...)`, which do not and fail
 *  with `Could not find table/view cross`. Folding the contents of every
 *  double-quoted identifier to upper case makes both shapes land on one name.
 *
 *  **A double quote is not always an identifier**, which cost a test: a
 *  column holding the JSON `{"draft":"kept"}` is a *value*, inside single
 *  quotes, and folding it turned the data into `{"DRAFT":"KEPT"}`. So this
 *  walks the statement instead of running a regular expression over it, and
 *  copies anything inside a single-quoted literal verbatim, `''` included. */
function foldIdentifiers(sql) {
  let out = "";
  let plainRun = "";
  const flush = () => {
    // Outside any literal: the runtime builds a WHERE out of
    // `true AND true AND ...` when it has no real condition, which SQLite
    // takes and HANA answers with `incorrect syntax near "AND"`. This is the
    // one genuine dialect rewrite the client needs.
    out += plainRun.replace(/\btrue\b/gi, "1 = 1").replace(/\bfalse\b/gi, "1 = 0");
    plainRun = "";
  };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {                       // a value: copy it exactly
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j += 1; break; }
        j += 1;
      }
      flush();
      out += sql.slice(i, j);
      i = j;
    } else if (c === '"') {                // an identifier: fold it
      const close = sql.indexOf('"', i + 1);
      if (close === -1) { plainRun += sql.slice(i); break; }
      const id = sql.slice(i + 1, close);
      flush();
      out += /^[A-Za-z_][A-Za-z_0-9]*$/.test(id) ? '"' + id.toUpperCase() + '"' : sql.slice(i, close + 1);
      i = close + 1;
    } else {
      plainRun += c;
      i += 1;
    }
  }
  flush();
  return out;
}

/** a row of the seam is flat: number | string | Uint8Array | null */
function plain(value) {
  if (typeof value === "bigint") return Number(value);
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof Date) return value;
  if (typeof value === "object" && typeof value.toString === "function") return value.toString();
  return value;
}

export function hanaConnection(input = {}) {
  // the same search as tools/amdp-run.mjs, and for the same reason: a
  // deployment is rebuilt by rsync --delete and a bundled module has no url
  // of its own, so the password lives outside both
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const candidates = [];
  if (process.env.OSD_HANA_PASSWORD_FILE) candidates.push(process.env.OSD_HANA_PASSWORD_FILE);
  if (home !== "") candidates.push(join(home, ".osd", "hxe-password"));
  try {
    candidates.push(fileURLToPath(new URL("../.local/hxe-password", import.meta.url)));
  } catch { /* bundled: the two above are the answer */ }
  const passwordFile = candidates.find((f) => existsSync(f)) ?? "";
  return {
    host: input.host ?? process.env.HANA_HOST ?? process.env.HXE_HOST ?? "localhost",
    port: Number(input.port ?? process.env.HANA_PORT ?? process.env.HXE_PORT ?? 39017),
    user: input.user ?? process.env.HANA_USER ?? process.env.HXE_USER ?? "SYSTEM",
    password: input.password ?? process.env.HANA_PASSWORD ?? process.env.HXE_PASSWORD
      ?? (passwordFile === "" ? undefined : readFileSync(passwordFile, "utf8").trim()),
    // node-hdb defaults to a 128 KB packet and refuses a statement that does
    // not fit with "Packet size limit exceeded". The transpiler's seed puts
    // whole ABAP sources into reposrc and SMW0 media into wwwdata as hex, so
    // a single INSERT is megabytes. The driver's own maximum is 2^30-1.
    packetSize: Number(input.packetSize ?? process.env.HANA_PACKET_SIZE ?? 1024 * 1024 * 64),
    packetSizeLimit: Number(input.packetSize ?? process.env.HANA_PACKET_SIZE ?? 1024 * 1024 * 64),
  };
}

export class HanaDatabaseClient {
  constructor(input = {}) {
    // what sy-dbsys reports; a real system running on HANA says HDB
    this.name = "HDB";
    this.trace = input.trace === true;
    this.schema = input.schema ?? process.env.HANA_SCHEMA ?? "OSD";
    this.options = input;
    this.client = undefined;
    this.inTransaction = false;
  }

  #run(sql) {
    return new Promise((resolve, reject) =>
      this.client.exec(sql, (err, result) => (err ? reject(err) : resolve(result))));
  }

  async connect() {
    const hdb = require("hdb");
    this.client = hdb.createClient(hanaConnection(this.options));
    await new Promise((resolve, reject) => this.client.connect((err) => (err ? reject(err) : resolve())));
    // COMMIT and ROLLBACK are meaningless while the session autocommits, and
    // the LUW of docs/db-backends.md depends on them meaning something
    this.client.setAutoCommit(false);
    // STG_DB_FRESH=1 means start from nothing; without it a second run meets
    // the tables the first one left and dies on "duplicate table name"
    if (process.env.STG_DB_FRESH === "1") {
      await this.#run(`DROP SCHEMA "${this.schema}" CASCADE`).catch(() => undefined);
      await new Promise((resolve, reject) => this.client.commit((e) => (e ? reject(e) : resolve())));
    }
    await this.#run(`CREATE SCHEMA "${this.schema}"`).catch(() => undefined);
    await this.#run(`SET SCHEMA "${this.schema}"`);
    globalThis.abap?.builtin?.sy?.get()?.dbsys?.set(this.name);
  }

  async disconnect() {
    await this.commit();
    this.client?.end();
    this.client = undefined;
  }

  /** a persisted schema already carries the tables. The name is upper case
   *  because that is how hanaSchema creates it; asking for 'zstg_demo' finds
   *  nothing and the setup then tries to create everything a second time. */
  async hasSchema() {
    const rows = await this.query(
      `SELECT COUNT(*) AS N FROM SYS.TABLES WHERE SCHEMA_NAME = '${this.schema}' AND TABLE_NAME = 'ZSTG_DEMO'`);
    // query() folds the keys of a row to lower case, which is the rule the
    // runtime needs -- so the alias comes back as `n`, not `N`. Reading it as
    // `N` made this answer false against a schema that was plainly there, and
    // the setup then tried to create every table a second time.
    return Number(rows[0]?.n ?? 0) > 0;
  }

  async execute(sql) {
    if (Array.isArray(sql)) {
      for (const s of sql) await this.execute(s);
      return;
    }
    if (sql === "") return;
    const folded = foldIdentifiers(sql);
    if (this.trace) console.log(folded);
    await this.#run(folded);
  }

  async beginTransaction() {
    // hdb opens one implicitly on the first statement once autocommit is off;
    // the flag is what commit() and rollback() read
    this.inTransaction = true;
  }

  async commit() {
    if (this.inTransaction === false) return;
    await new Promise((resolve, reject) => this.client.commit((err) => (err ? reject(err) : resolve())));
    this.inTransaction = false;
  }

  async rollback() {
    if (this.inTransaction === false) return;
    await new Promise((resolve, reject) => this.client.rollback((err) => (err ? reject(err) : resolve())));
    this.inTransaction = false;
  }

  /** one modifying statement; the count of rows it touched */
  async #modifying(sql) {
    await this.beginTransaction();
    const folded = foldIdentifiers(sql);
    if (this.trace) console.log(folded);
    const affected = await this.#run(folded);
    return typeof affected === "number" ? affected : Number(affected ?? 0);
  }

  async insert(options) {
    const sql = trimLiterals(
      `INSERT INTO ${options.table} (${options.columns.join(",")}) VALUES (${options.values.join(",")})`);
    try {
      const dbcnt = await this.#modifying(sql);
      return {subrc: 0, dbcnt};
    } catch (e) {
      if (this.trace) console.error(e);
      return {subrc: 4, dbcnt: 0};
    }
  }

  async update(options) {
    const sql = trimLiterals(`UPDATE ${options.table} SET ${options.set.join(", ")} WHERE ${options.where}`);
    try {
      const dbcnt = await this.#modifying(sql);
      return {subrc: dbcnt === 0 ? 4 : 0, dbcnt};
    } catch (e) {
      if (this.trace) console.error(e);
      return {subrc: 4, dbcnt: 0};
    }
  }

  async delete(options) {
    let sql = `DELETE FROM ${options.table}`;
    if (options.where !== "") sql += ` WHERE ${options.where}`;
    try {
      const dbcnt = await this.#modifying(trimLiterals(sql));
      return {subrc: dbcnt === 0 ? 4 : 0, dbcnt};
    } catch (e) {
      if (this.trace) console.error(e);
      return {subrc: 4, dbcnt: 0};
    }
  }

  /** ABAP SQL as the runtime emits it, into what HANA takes */
  rewrite(select, primaryKey) {
    let s = select.replace(/ UP TO (\d+) ROWS(.*)/i, "$2 LIMIT $1");
    s = primaryKey
      ? s.replace(/ ORDER BY PRIMARY KEY/i, " ORDER BY " + primaryKey.join(", "))
      : s.replace(/ ORDER BY PRIMARY KEY/i, "");
    s = s.replace(/ ASCENDING/ig, " ASC").replace(/ DESCENDING/ig, " DESC")
      .replace(/~/g, ".").replace(/ LIMIT 0/g, "");
    return trimLiterals(s);
  }

  async query(sql) {
    const folded = foldIdentifiers(sql);
    if (this.trace) console.log(folded);
    try {
      const rows = await this.#run(folded);
      // The names come back the way HANA holds them, which is upper case,
      // and the runtime looks a column up by the lower-case name it asked
      // for -- `rowsToTarget` reads row[field] and calls set() on what it
      // finds, so an upper-case key gives it undefined and it dies inside
      // Character.set with "Cannot read properties of undefined". Folding up
      // on the way out and down on the way back is one rule, applied twice.
      return (rows ?? []).map((r) => {
        const row = {};
        for (const k of Object.keys(r)) row[k.toLowerCase()] = plain(r[k]);
        return row;
      });
    } catch (error) {
      if (globalThis.abap?.Classes?.["CX_SY_DYNAMIC_OSQL_SEMANTICS"] !== undefined) {
        throw await new globalThis.abap.Classes["CX_SY_DYNAMIC_OSQL_SEMANTICS"]()
          .constructor_({sqlmsg: error.message || ""});
      }
      throw error;
    }
  }

  async select(options) {
    options.select = this.rewrite(options.select, options.primaryKey);
    return {rows: await this.query(options.select)};
  }

  // ---------------------------------------------------------------------
  // The native channel (docs/db-seam-native.md). Four methods beside the
  // eleven, for one caller only: the SQLScript splitter's lowering.
  //
  // **Nothing transpiled from ABAP may reach these.** Open SQL goes through
  // select()/insert()/update()/delete(), which rewrite and fold and trim; a
  // statement arriving here is sent to the engine untouched, which is the
  // whole point and also the reason it must never carry ABAP SQL.
  // ---------------------------------------------------------------------

  /** this client can carry a lowered plan */
  get supportsNative() {
    return true;
  }

  /** ABAP's type letters into what hdb wants to bind. The caller knows the
   *  ABAP type and nothing about HANA; the mapping belongs here. */
  #bind(params = []) {
    return params.map((p) => {
      if (p.isNull === true) return null;
      switch ((p.type ?? "").charAt(0).toUpperCase()) {
        case "I": case "B": case "S": return Number(p.value);
        case "P": case "F": return Number(p.value);
        case "X": return Buffer.from(String(p.value), "hex");
        default: return p.value === undefined ? null : String(p.value);
      }
    });
  }

  /** One lowered statement, sent as written, with its values bound. */
  async native({sql, params = [], expect = "rows"}) {
    if (this.trace) console.log("native:", sql, params.length ? JSON.stringify(params) : "");
    const stmt = await new Promise((resolve, reject) =>
      this.client.prepare(sql, (err, s) => (err ? reject(err) : resolve(s))));
    try {
      if (expect === "none") {
        const affected = await new Promise((resolve, reject) =>
          stmt.exec(this.#bind(params), (err, r) => (err ? reject(err) : resolve(r))));
        return {rowCount: typeof affected === "number" ? affected : undefined};
      }
      const rows = await new Promise((resolve, reject) =>
        stmt.exec(this.#bind(params), (err, r) => (err ? reject(err) : resolve(r))));
      // the engine's declared column types, not a guess from the value:
      // blank padding, decimals and dates are exactly where guessing hurts
      const columns = (stmt.resultSetMetadata ?? []).map((c) => ({
        name: c.columnDisplayName ?? c.columnName,
        type: c.dataType,
      }));
      const plainRows = (rows ?? []).map((r) => {
        const row = {};
        for (const k of Object.keys(r)) row[k] = plain(r[k]);
        return row;
      });
      if (expect === "scalar") {
        const first = plainRows[0];
        return {value: first === undefined ? undefined : first[Object.keys(first)[0]], columns};
      }
      return {rows: plainRows, columns, rowCount: plainRows.length};
    } finally {
      stmt.drop?.(() => undefined);
    }
  }

  /** A named relation later statements may refer to. The name is **ours**:
   *  the caller may not invent one, because quoting and escaping are the
   *  engine's business and this is the only place that knows them. */
  async defineRelation({name = "rel", sql, params = [], materialise}) {
    this.relationCount = (this.relationCount ?? 0) + 1;
    const ident = `OSD_${String(name).replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}_${process.pid}_${this.relationCount}`;
    const handle = {
      ident,
      ref: `"${this.schema}"."${ident}"`,
      kind: materialise === undefined ? "definition" : "materialised",
      reason: materialise,
    };
    if (materialise === undefined) {
      // a view is HANA's cheapest definition, and it keeps the relation
      // inside the engine rather than becoming rows on the way through us
      await this.#run(`CREATE VIEW ${handle.ref} AS ${sql}`);
    } else {
      // A materialised relation is a **column table**, not a local temporary
      // one: HANA insists a local temporary name begins with '#', which is
      // not a name a schema-qualified reference can carry, and the splitter
      // needs a reference it can splice anywhere. The client drops it.
      handle.ref = `"${this.schema}"."${ident}"`;
      await this.#run(`CREATE COLUMN TABLE ${handle.ref} AS (${sql}) WITH DATA`);
    }
    return handle;
  }

  /** what to splice into a statement: quoted and escaped for this engine */
  relationRef(handle) {
    return handle.ref;
  }

  /** what the client actually did, and why -- materialising is not a
   *  performance hint here, it changes whether an exception happens
   *  (docs/sqlscript-hana-observed.md) */
  relationKind(handle) {
    return {kind: handle.kind, reason: handle.reason};
  }

  async dropRelation(handle) {
    const what = handle.kind === "definition" ? "VIEW" : "TABLE";
    await this.#run(`DROP ${what} ${handle.ref}`).catch(() => undefined);
  }

  /** the seam allows a cursor to be served by reading everything and slicing,
   *  which is what the DuckDB client does and what this does */
  async openCursor(options) {
    const rows = await this.query(this.rewrite(options.select, options.primaryKey));
    let offset = 0;
    return {
      fetchNextCursor: async (packageSize) => {
        const slice = rows.slice(offset, offset + packageSize);
        offset += packageSize;
        return {rows: slice};
      },
      closeCursor: async () => undefined,
    };
  }
}

/** HANA takes the PostgreSQL DDL the transpiler writes, with every identifier
 *  quoted in UPPER case.
 *
 *  Three shapes were tried and only the third works, measured rather than
 *  reasoned about:
 *
 *  - **as written**, quoted lower case: HANA accepts all 77 CREATE TABLE, and
 *    then nothing can be read. The SQL the runtime emits names tables and
 *    columns unquoted, HANA folds an unquoted name to upper case, and
 *    ITEM_ID is not "item_id". Error: `invalid column name:
 *    zosd_test_item.ITEM_ID`.
 *  - **unquoted**: both sides fold alike and it very nearly works -- until a
 *    column is called `cross`, which is one of HANA's reserved words. Error:
 *    `incorrect syntax near "cross"`. `SYS.RESERVED_KEYWORDS` also holds END,
 *    GROUP, ORDER and START, all plausible ABAP field names.
 *  - **quoted upper case**: an unquoted reference folds to upper and finds
 *    it, and a reserved word is safe behind its quotes. This one.
 */
export function hanaSchema(schemas) {
  return schemas.pg.map((s) => s.replace(/"([A-Za-z_][A-Za-z_0-9]*)"/g, (m, id) => '"' + id.toUpperCase() + '"'));
}

/** The seed INSERTs reach us in two shapes and both need the same treatment
 *  the schema got: identifiers quoted in UPPER case.
 *
 *  Some name their columns in single quotes, which HANA reads as string
 *  literals rather than identifiers -- the shape DuckDB also has to fix. The
 *  rest arrive already double-quoted and in **lower** case, which is the
 *  shape that produced `invalid column name: pgmid` against a table whose
 *  column is "PGMID". Both are folded here; a value is in single quotes and
 *  is never touched, because only an identifier is in double quotes. */
export function hanaInserts(inserts) {
  return inserts.map((s) => {
    const withColumns = s.replace(/^(INSERT INTO \S+ \()([^)]*)\)/i, (m, head, cols) =>
      (/'/.test(cols) ? head + cols.replace(/'([A-Za-z_0-9]+)'/g, (mm, c) => '"' + c.toUpperCase() + '"') + ")" : m));
    return foldIdentifiers(withColumns)
      .replace(/^INSERT INTO ([A-Za-z_][A-Za-z_0-9]*) /i, (m, t) => `INSERT INTO "${t.toUpperCase()}" `);
  });
}
