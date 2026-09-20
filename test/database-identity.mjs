import {expect} from "chai";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {HanaDatabaseClient} from "../tools/hana-client.mjs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";

describe("database identity", () => {
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
