import {expect} from "chai";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {DuckDBDatabaseClient, duckdbSchema} from "../tools/duckdb-client.mjs";
import {fingerprintOf} from "../tools/osd-persist.mjs";
import {OsdPostgresClient} from "../tools/postgres-client.mjs";
import {beforeAdtHandleDDL, migrateAdtHandleFile, beforeJobReleaseDDL, beforeJobScheduleDDL,
  beforeJobStepInputDDL, beforeJobEventDDL, beforeJobPredecessorDDL} from "./setup.mjs";

const run = promisify(execFile);
// Use the generation's complete DDL, including its current packs and views.
// The old handle fixture is independent of the migration's before-DDL helper.
function schemas() {
  const source = readFileSync("output/init.mjs", "utf8");
  const ddl = {sqlite: [], pg: []};
  for (const [, backend, statement] of source.matchAll(/^\s*(sqlite|pg)\.push\(`([^`]+)`\);$/gm)) ddl[backend].push(statement);
  expect(ddl.sqlite.length).to.be.greaterThan(10);
  expect(ddl.pg.length).to.be.greaterThan(10);
  return ddl;
}
function oldHandle(ddl) {
  return ddl.map(sql => /CREATE TABLE ['"]zosd_adt_shdl['"]/i.test(sql)
    ? sql.replace(/(['"]handle['"] NCHAR\()40(\))/i, (_all, head, tail) => head + "36" + tail) : sql);
}
const sentinel = "INSERT INTO zstg_demo (mandt, travel_id, description, status, seats) VALUES ('123', 'MIG_KEEP', 'survives handle upgrade', 'O', 7)";
const boot = `
  import {initializeABAP} from './output/init.mjs';
  import {AbapSessions} from './tools/adt-abap-sessions.mjs';
  import {save} from './tools/osd-persist.mjs';
  await initializeABAP();
  const db = globalThis.abap.context.databaseConnections.DEFAULT;
  const sessions = new AbapSessions();
  const session = await sessions.open('migration');
  const {handle} = await sessions.lock(session, 'CLAS', 'ZMIGRATION');
  const stored = await db.select({select: "SELECT handle FROM zosd_adt_shdl WHERE objname = 'ZMIGRATION'"});
  const rows = await db.select({select: "SELECT description, seats FROM zstg_demo WHERE travel_id = 'MIG_KEEP'"});
  const holds = await sessions.holds(session, handle, 'CLAS', 'ZMIGRATION');
  const stamp = process.env.STG_DB === 'duckdb' ? null : (await db.select({select: 'SELECT fingerprint FROM osd_schema'})).rows[0].fingerprint;
  console.log('MIGRATION_RESULT=' + JSON.stringify({handle, stored: stored.rows[0].handle, rows: rows.rows, holds, stamp}));
  await sessions.end(session.id);
  await db.commit();
  save(db);
  await db.disconnect();
`;
async function start(path, backend, strict = false) {
  const env = {...process.env, STG_DB_PATH: path, STG_DB_STRICT: strict ? "1" : "0", STG_TLS: "0", OSD_JOB_WORKER: "extension"};
  if (backend === "heap") delete env.STG_DB; else env.STG_DB = backend;
  const {stdout} = await run(process.execPath, ["--input-type=module", "-e", boot], {cwd: resolve("."), env, timeout: 60000, maxBuffer: 4 * 1024 * 1024});
  return JSON.parse(stdout.match(/MIGRATION_RESULT=(.*)/)[1]);
}
function assertBoot(result) {
  expect(result.rows).to.deep.equal([{description: "survives handle upgrade", seats: 7}]);
  expect(result.handle).to.match(/^[a-f0-9]{40}$/);
  expect(result.stored).to.equal(result.handle);
  expect(result.holds).to.equal(true);
}
function sqliteFixture(path, ddl) {
  const db = new DatabaseSync(path);
  try {
    for (const sql of ddl) db.exec(sql);
    db.exec(sentinel);
    db.exec("CREATE TABLE osd_schema (fingerprint TEXT, at TEXT)");
    db.prepare("INSERT INTO osd_schema VALUES (?, 'old')").run(fingerprintOf(ddl));
    db.exec("INSERT INTO zosd_adt_shdl VALUES ('123', 'old-session', '012345678901234567890123456789012345', 'CLAS', 'ZOLD')");
  } finally { db.close(); }
}

describe("ADT handle DDIC upgrade preserves persistent business data", function () {
  this.timeout(120000);
  let dir, ddl;
  before(() => { ddl = schemas(); });
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "adt-handle-upgrade-")); });
  afterEach(() => { rmSync(dir, {recursive: true, force: true}); });

  for (const backend of ["file", "heap"]) {
    it(`${backend}: a stamped CHAR36 database starts without drift, keeps user rows and LOCK stores/returns all 40 characters`, async () => {
      const path = join(dir, "business.sqlite");
      const old = oldHandle(ddl.sqlite);
      expect(beforeAdtHandleDDL(ddl.sqlite)).to.deep.equal(old);
      expect(fingerprintOf(old)).not.to.equal(fingerprintOf(ddl.sqlite));
      sqliteFixture(path, old);
      for (let n = 0; n < 2; n++) {
        const result = await start(path, backend, n === 1);
        assertBoot(result);
        expect(result.stamp).to.equal(fingerprintOf(ddl.sqlite));
        expect(readdirSync(dir).filter(name => name.includes(".drift"))).to.deep.equal([]);
      }
      const db = new DatabaseSync(path);
      try {
        expect(db.prepare("PRAGMA table_info(zosd_adt_shdl)").all().find(c => c.name === "handle").type).to.equal("NCHAR(40)");
        expect(db.prepare("SELECT COUNT(*) AS n FROM zosd_adt_shdl WHERE objname = 'ZOLD'").get().n).to.equal(0);
      } finally { db.close(); }
    });
  }

  const stages = [beforeJobReleaseDDL, beforeJobScheduleDDL, beforeJobStepInputDDL, beforeJobEventDDL, beforeJobPredecessorDDL,
    schema => schema.filter(sql => !/^CREATE TABLE ['"]zosd_job_identity['"]/i.test(sql)),
    schema => schema.filter(sql => !/^CREATE TABLE ['"]zosd_job_step['"]/i.test(sql)).map(sql => /^CREATE TABLE ['"]zosd_job_outbox['"]/i.test(sql)
      ? sql.replace(/,\s*['"]step_count['"]\s+NCHAR\(2\)/i, "") : sql)];
  for (let stage = 0; stage < stages.length; stage++) {
    it(`file: composes all job migrations from prior stage ${stage + 1} before widening handles`, async () => {
      const old = stages.slice(0, stage + 1).reduce((schema, before) => before(schema), oldHandle(ddl.sqlite));
      const path = join(dir, "jobs.sqlite");
      sqliteFixture(path, old);
      const result = await start(path, "file", true);
      assertBoot(result);
      expect(result.stamp).to.equal(fingerprintOf(ddl.sqlite));
      expect(readdirSync(dir).filter(name => name.includes(".drift"))).to.deep.equal([]);
    });
  }

  it("DuckDB: reopens an old VARCHAR36 file, keeps user rows and LOCK stores/returns all 40 characters", async () => {
    const path = join(dir, "business.duckdb");
    const client = new DuckDBDatabaseClient({path});
    try {
      await client.connect();
      await client.execute(duckdbSchema({pg: oldHandle(ddl.pg)}));
      await client.execute(sentinel);
    } finally { await client.disconnect(); }
    // DuckDB has no schema stamp and VARCHAR(n) does not enforce n.
    for (let n = 0; n < 2; n++) assertBoot(await start(path, "duckdb"));
    expect(readdirSync(dir).filter(name => name.includes(".drift"))).to.deep.equal([]);
  });

  it("file: rejects unknown fingerprints and rolls back table recreation if stamping fails", () => {
    const path = join(dir, "rollback.sqlite"), old = oldHandle(ddl.sqlite);
    sqliteFixture(path, old);
    const db = new DatabaseSync(path);
    try {
      const wanted = fingerprintOf(ddl.sqlite), found = fingerprintOf(old);
      expect(migrateAdtHandleFile(db, "unknown", wanted, ddl.sqlite, fingerprintOf)).to.equal(false);
      db.exec("CREATE TRIGGER reject_stamp BEFORE UPDATE ON osd_schema BEGIN SELECT RAISE(ABORT, 'stamp failure'); END");
      expect(() => migrateAdtHandleFile(db, found, wanted, ddl.sqlite, fingerprintOf)).to.throw(/stamp failure/);
      expect(db.prepare("SELECT fingerprint FROM osd_schema").get().fingerprint).to.equal(found);
      expect(db.prepare("SELECT handle FROM zosd_adt_shdl").get().handle).to.have.length(36);
      expect(db.prepare("PRAGMA table_info(zosd_adt_shdl)").all().find(c => c.name === "handle").type).to.equal("NCHAR(36)");
    } finally { db.close(); }
  });

  for (const failure of [false, true]) {
    it(`PostgreSQL: ${failure ? "rolls back an ALTER failure" : "widens and stamps on one locked transaction session"}`, async () => {
      const schema = ddl.pg, found = fingerprintOf(oldHandle(schema)), wanted = fingerprintOf(schema);
      const client = new OsdPostgresClient({password: "fixture"});
      const calls = [];
      let stamp = found, releases = 0;
      const query = async input => {
        const sql = typeof input === "string" ? input : input.text;
        calls.push(sql);
        if (sql.includes("to_regclass")) return {rows: [{name: "osd_schema"}]};
        if (sql.startsWith("SELECT fingerprint")) return {rows: [{fingerprint: stamp + " "}]};
        if (sql.startsWith("ALTER TABLE") && failure) throw new Error("alter failure");
        if (sql.startsWith("UPDATE osd_schema")) stamp = wanted;
        return {rows: []};
      };
      client.pool = {query, connect: async () => ({query, release: () => { releases++; }})};
      if (failure) {
        let error;
        try { await client.hasSchema(schema); } catch (e) { error = e; }
        expect(error?.message).to.equal("alter failure");
        expect(stamp).to.equal(found);
        expect(calls.at(-1)).to.equal("ROLLBACK");
      } else {
        expect(await client.hasSchema(schema)).to.equal(true);
        expect(stamp).to.equal(wanted);
        expect(calls.slice(2)).to.deep.equal(["BEGIN", "SELECT fingerprint FROM osd_schema LIMIT 1 FOR UPDATE",
          'ALTER TABLE "zosd_adt_shdl" ALTER COLUMN "handle" TYPE CHARACTER(40)',
          `UPDATE osd_schema SET fingerprint = '${wanted}'`, "COMMIT"]);
        calls.length = 0;
        expect(await client.hasSchema(schema)).to.equal(true);
        expect(calls).to.have.length(2);
        stamp = "unknown";
        let error;
        try { await client.hasSchema(schema); } catch (e) { error = e; }
        expect(error?.message).to.match(/schema drift/);
      }
      expect(releases).to.equal(1);
      expect(client.client).to.equal(undefined);
    });
  }
});
