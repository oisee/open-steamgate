// The file-backed SQLite client: the three properties B4 promised, each a test.
import {expect} from "chai";
import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
import {FileSqliteClient, setAsideDatabase} from "../tools/sqlite-file-client.mjs";

const DDL = "CREATE TABLE 't' ('mandt' NCHAR(3) COLLATE RTRIM, 'id' NCHAR(8) COLLATE RTRIM, 'name' NCHAR(40) COLLATE RTRIM, PRIMARY KEY('mandt','id'))";

describe("tools/sqlite-file-client: rows on disk while the process runs", function () {
  this.timeout(30000);
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), "osd-sqlite-")); });
  after(() => rmSync(dir, {recursive: true, force: true}));

  it("a committed row survives a process that is killed, not asked to exit", () => {
    const file = join(dir, "crash.sqlite");
    // a child that writes, commits, and then dies with no chance to save
    const script = `
      const {FileSqliteClient} = await import(${JSON.stringify(new URL("../tools/sqlite-file-client.mjs", import.meta.url).href)});
      const db = new FileSqliteClient({path: ${JSON.stringify(file)}});
      await db.connect();
      await db.execute(${JSON.stringify(DDL)});
      await db.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'A'", "'alpha'"]});
      await db.commit();
      await db.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'B'", "'not committed'"]});
      process.kill(process.pid, "SIGKILL");
    `;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {encoding: "utf8"});
    expect(r.signal, `the child was killed: ${r.stderr}`).to.equal("SIGKILL");
    expect(existsSync(file)).to.equal(true);
  });

  it("…and the row is there when the file is opened again, and the uncommitted one is not", async () => {
    const db = new FileSqliteClient({path: join(dir, "crash.sqlite")});
    await db.connect();
    const {rows} = await db.select({select: "SELECT id, name FROM t ORDER BY PRIMARY KEY", primaryKey: ["id"]});
    expect(rows.map((r) => r.id)).to.deep.equal(["A"]);
    await db.disconnect();
  });

  it("ROLLBACK WORK undoes the LUW, subrc 4 is a refused statement, dbcnt counts", async () => {
    const db = new FileSqliteClient({path: join(dir, "luw.sqlite")});
    await db.connect();
    await db.execute(DDL);
    expect(await db.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'A'", "'a'"]})).to.deep.equal({subrc: 0, dbcnt: 1});
    expect((await db.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'A'", "'dup'"]})).subrc, "a duplicate key").to.equal(4);
    await db.rollback();
    expect((await db.select({select: "SELECT * FROM t"})).rows.length, "rolled back").to.equal(0);
    await db.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'A'", "'a'"]});
    await db.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'B'", "'b'"]});
    expect(await db.update({table: "t", set: ["name = 'z'"], where: "id = 'A'"})).to.deep.equal({subrc: 0, dbcnt: 1});
    expect(await db.delete({table: "t", where: "id = 'Q'"})).to.deep.equal({subrc: 4, dbcnt: 0});
    expect(await db.delete({table: "t", where: "id = 'B'"})).to.deep.equal({subrc: 0, dbcnt: 1});
    await db.commit();
    expect((await db.select({select: "SELECT t~name FROM t UP TO 1 ROWS"})).rows).to.deep.equal([{name: "z"}]);
    await db.disconnect();
  });

  it("a second connection reads what the first committed, and not what it has not", async () => {
    const file = join(dir, "two.sqlite");
    const writer = new FileSqliteClient({path: file});
    await writer.connect();
    await writer.execute(DDL);
    await writer.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'A'", "'seen'"]});
    await writer.commit();
    await writer.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'B'", "'not yet'"]});
    const reader = new FileSqliteClient({path: file, readOnly: true});
    await reader.connect();
    const {rows} = await reader.select({select: "SELECT id FROM t ORDER BY PRIMARY KEY", primaryKey: ["id"]});
    expect(rows.map((r) => r.id), "the writer's open LUW is invisible").to.deep.equal(["A"]);
    await writer.commit();
    const again = await reader.select({select: "SELECT id FROM t ORDER BY PRIMARY KEY", primaryKey: ["id"]});
    expect(again.rows.map((r) => r.id), "and visible once committed").to.deep.equal(["A", "B"]);
    await reader.disconnect();
    await writer.disconnect();
  });

  it("a fork carries the last commit and nothing of the open LUW, and is a whole file", async () => {
    const {forkDatabase} = await import("../tools/sqlite-file-client.mjs");
    const file = join(dir, "fork-src.sqlite");
    const writer = new FileSqliteClient({path: file});
    await writer.connect();
    await writer.execute(DDL);
    await writer.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'A'", "'a'"]});
    await writer.commit();
    await writer.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'B'", "'open'"]});
    const to = join(dir, "forks", "one.sqlite");
    forkDatabase(file, to);
    const fork = new FileSqliteClient({path: to});
    await fork.connect();
    expect((await fork.select({select: "SELECT id FROM t"})).rows.map((r) => r.id)).to.deep.equal(["A"]);
    await fork.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'Z'", "'mine'"]});
    await fork.commit();
    await writer.commit();
    expect((await writer.select({select: "SELECT id FROM t ORDER BY PRIMARY KEY", primaryKey: ["id"]})).rows.map((r) => r.id), "the source never sees the fork's rows").to.deep.equal(["A", "B"]);
    await fork.disconnect();
    await writer.disconnect();
  });


  // The i7 outage of 2026-09-19, and exactly as much of it as was measured.
  //
  // What was measured. A serving runtime from the previous night still had
  // `.local/db/osd.sqlite` open and its `-shm` mapped (lsof, /proc/maps)
  // when the drift path moved that database aside -- the database only, the
  // `-shm` stayed under the live name. Every runtime that booted afterwards
  // died on `PRAGMA journal_mode = WAL` with errcode 522, which prints as
  // "disk I/O error" and names nothing, for eight hours. The same bytes
  // copied to another directory opened fine; the same path opened fine the
  // moment that process was killed, with nothing on disk changed. So the
  // live mapping was the condition.
  //
  // What was NOT measured: why. Four attempts to reproduce the 522 from
  // that shape -- a holder alive, the database renamed away, the sidecars
  // left, the holder writing into the shared -wal -- all opened cleanly on
  // this SQLite. So this test does not claim to catch the outage. It states
  // the rule the outage argues for and nothing wider: a WAL database is
  // three files, and an index left under the name of a database that is
  // gone belongs to nobody.
  const holdOpen = async (file) => {
    const script = `
      const {FileSqliteClient} = await import(${JSON.stringify(new URL("../tools/sqlite-file-client.mjs", import.meta.url).href)});
      const db = new FileSqliteClient({path: ${JSON.stringify(file)}});
      await db.connect();
      console.log("held");
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {stdio: ["ignore", "pipe", "inherit"]});
    await new Promise((ok, fail) => {
      child.stdout.on("data", (b) => String(b).includes("held") && ok());
      child.on("exit", (code) => fail(new Error(`the holder exited ${code} before it held anything`)));
    });
    return child;
  };

  const bootA = async (file) => {
    const db = new FileSqliteClient({path: file});
    await db.connect();
    const n = (await db.select({select: "SELECT COUNT(*) AS n FROM sqlite_master"})).rows[0].n;
    await db.disconnect();
    return Number(n);
  };

  it("a database moved aside takes its -wal and -shm with it", async () => {
    const file = join(dir, "aside.sqlite");
    const writer = new FileSqliteClient({path: file});
    await writer.connect();
    await writer.execute(DDL);
    await writer.insert({table: "t", columns: ["mandt", "id", "name"], values: ["'001'", "'A'", "'alpha'"]});
    await writer.commit();
    await writer.disconnect();

    const holder = await holdOpen(file);
    try {
      setAsideDatabase(file, `${file}.drift`);
      expect(existsSync(`${file}.drift`), "the database").to.equal(true);
      expect(existsSync(`${file}-shm`), "no index is left under the old name").to.equal(false);
      expect(existsSync(`${file}-wal`), "no log is left under the old name").to.equal(false);
      // the next runtime boots on a database that does not exist yet
      expect(await bootA(file)).to.equal(0);
    } finally {
      holder.kill("SIGKILL");
    }
  });

  it("the stamp says which DDIC the rows were made for", async () => {
    const db = new FileSqliteClient({path: join(dir, "stamp.sqlite")});
    await db.connect();
    expect(await db.stampedSchema()).to.equal(undefined);
    const fp = await db.stamp([DDL]);
    expect(fp).to.match(/^[0-9a-f]{16}$/);
    expect(await db.stampedSchema()).to.equal(fp);
    await db.disconnect();
  });
});

describe("tools/sqlite-file-client: an INTEGER parameter binds as INTEGER", () => {
  it("reads back as '1', not '1.0' (node:sqlite binds a JavaScript number as REAL)", async () => {
    const {FileSqliteClient} = await import("../tools/sqlite-file-client.mjs");
    const client = new FileSqliteClient({path: ":memory:"});
    await client.connect();
    try {
      const {rows} = await client.native({sql: "SELECT CAST(? AS TEXT) AS T, typeof(?) AS Y",
        params: [{name: "a", value: 1, type: "I"}, {name: "b", value: 7, type: "I"}]});
      expect(rows[0]).to.deep.include({T: "1", Y: "integer"});
    } finally {
      await client.disconnect();
    }
  });
});
