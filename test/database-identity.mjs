import {expect} from "chai";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {HanaDatabaseClient} from "../tools/hana-client.mjs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {OsdPostgresClient, postgresInserts} from "../tools/postgres-client.mjs";

describe("database identity", () => {
  it("rewrites only PostgreSQL seed column identifiers, not string values", () => {
    expect(postgresInserts(["INSERT INTO tadir ('OBJECT', 'OBJ_NAME') VALUES ('PROG', 'demo')", "SELECT 'OBJECT'"]))
      .to.deep.equal(["INSERT INTO tadir (\"object\", \"obj_name\") VALUES ('PROG', 'demo')", "SELECT 'OBJECT'"]);
  });
  it("does not claim PostgreSQL connected until a query succeeds", async () => {
    const client = new OsdPostgresClient({host: "127.0.0.1", port: 1, user: "osd", password: "test", database: "osd"});
    client.select = async () => { throw new Error("connection refused"); };
    try {
      await client.connect();
      throw new Error("expected a failed connection");
    } catch (error) {
      expect(error.message).to.equal("connection refused");
      expect(client.connected).to.equal(false);
    } finally {
      await client.disconnect();
    }
  });
  it("checks PostgreSQL on an isolated session, never the active LUW", async () => {
    const client = new OsdPostgresClient({password: "test"});
    let activeCalls = 0;
    let released = false;
    const statements = [];
    client.client = {query: async () => { activeCalls += 1; }};
    client.pool = {connect: async () => ({
      query: async (sql) => { statements.push(sql); },
      release: () => { released = true; },
    })};
    await client.checkSelect("SELECT 1");
    expect(activeCalls).to.equal(0);
    expect(statements[0]).to.match(/^PREPARE osd_check_[a-z0-9_]+ AS SELECT 1$/);
    expect(statements[1]).to.match(/^DEALLOCATE osd_check_[a-z0-9_]+$/);
    expect(released).to.equal(true);
  });
  it("preserves the HDB identifier after a mocked HANA connection (no network)", async () => {
    const hdb = createRequire(import.meta.url)("hdb");
    const originalCreate = hdb.createClient;
    const before = globalThis.abap;
    let dbsys;
    let fail = true;
    hdb.createClient = () => ({
      connect: (cb) => cb(fail ? new Error("mock connection refused") : null),
      setAutoCommit() {},
      exec: (_sql, cb) => cb(null, []),
      commit: (cb) => cb(null),
      end() {},
    });
    const client = new HanaDatabaseClient({host: "localhost", user: "mock", password: "mock"});
    globalThis.abap = {
      context: {databaseConnections: {DEFAULT: client}},
      builtin: {sy: {get: () => ({dbsys: {set: (value) => { dbsys = value; }}})}},
    };
    try {
      let error;
      try { await client.connect(); } catch (e) { error = e; }
      expect(error?.message).to.equal("mock connection refused");
      expect(client.connected).to.equal(false);
      expect(dbsys).to.equal(undefined);
      fail = false;
      await client.connect();
      expect(dbsys).to.equal("HDB");
      expect(client.connected).to.equal(true);
      await client.disconnect();
      expect(client.connected).to.equal(false);
    } finally {
      hdb.createClient = originalCreate;
      globalThis.abap = before;
    }
  });
  it("sets sy-dbsys only after DuckDB connects", async () => {
    const root = mkdtempSync(join(tmpdir(), "osd-db-identity-"));
    let dbsys;
    const before = globalThis.abap;
    globalThis.abap = {
      context: {databaseConnections: {}},
      builtin: {sy: {get: () => ({dbsys: {set: (value) => { dbsys = value; }}})}},
    };
    const client = new DuckDBDatabaseClient({path: join(root, "identity.duckdb")});
    globalThis.abap.context.databaseConnections.DEFAULT = client;
    try {
      expect(dbsys).to.equal(undefined);
      await client.connect();
      expect(dbsys).to.equal("duckdb");
      expect(client.connected).to.equal(true);
      await client.disconnect();
      expect(client.connected).to.equal(false);
    } finally {
      await client.disconnect();
      globalThis.abap = before;
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("names missing DuckDB tables instead of accepting a partial persistent schema", async () => {
    const client = new DuckDBDatabaseClient({path: ":memory:"});
    try {
      await client.connect();
      await client.execute(`CREATE TABLE "ZSTG_DEMO" ("ID" INTEGER)`);
      expect(await client.missingTables(["ZSTG_DEMO", "ZVDB_100_VEC"]))
        .to.deep.equal(["ZVDB_100_VEC"]);
    } finally {
      await client.disconnect();
    }
  });

  it("tracks the file SQLite connection lifecycle", async () => {
    const root = mkdtempSync(join(tmpdir(), "osd-sqlite-identity-"));
    const before = globalThis.abap;
    let dbsys;
    globalThis.abap = {
      context: {databaseConnections: {}},
      builtin: {sy: {get: () => ({dbsys: {set: (value) => { dbsys = value; }}})}},
    };
    const client = new FileSqliteClient({path: join(root, "identity.sqlite")});
    globalThis.abap.context.databaseConnections.DEFAULT = client;
    try {
      await client.connect();
      expect(dbsys).to.equal("sqlite");
      expect(client.connected).to.equal(true);
      await client.disconnect();
      expect(client.connected).to.equal(false);
    } finally {
      await client.disconnect();
      globalThis.abap = before;
      rmSync(root, {recursive: true, force: true});
    }
  });
  for (const Adapter of [DuckDBDatabaseClient, FileSqliteClient]) {
    it(`${Adapter.name}: a failed connect does not claim a backend`, async () => {
      const root = mkdtempSync(join(tmpdir(), "osd-failed-identity-"));
      const before = globalThis.abap;
      let dbsys = "previous";
      const client = new Adapter({path: root}); // A directory is not a database file.
      globalThis.abap = {
        context: {databaseConnections: {DEFAULT: client}},
        builtin: {sy: {get: () => ({dbsys: {set: (value) => { dbsys = value; }}})}},
      };
      try {
        let error;
        try { await client.connect(); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(Error);
        expect(client.connected).to.equal(false);
        expect(dbsys).to.equal("previous");
      } finally {
        await client.disconnect();
        globalThis.abap = before;
        rmSync(root, {recursive: true, force: true});
      }
    });
  }
});
