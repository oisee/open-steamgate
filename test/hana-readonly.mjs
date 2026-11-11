import {expect} from "chai";
import {HanaDatabaseClient, statementKind} from "../tools/hana-client.mjs";

// The read-only guard of the existing-schema mode (docs/db-backends.md,
// "Existing schema, read-only").
//
// HANA_EXISTING_SCHEMA=1 runs over a schema an SAP system already holds. A
// write this runtime did not make is a corruption of somebody's system, so
// unless OSD_HANA_WRITE=1 every statement that is not a SELECT is refused
// before it reaches the driver: one chokepoint every DatabaseClient method
// passes through. The fake driver below records what reaches it -- the point
// of the test is that a refused statement reaches nothing at all, and that
// the refusal names the statement's kind, never its text: the text may carry
// data.
describe("the HANA read-only guard", () => {
  // what the client would reach on a real HANA. No prepare: query() then
  // takes the plain exec path, exactly like the older test doubles in
  // test/hana-dialect.mjs.
  const fakeDriver = () => {
    const seen = [];
    const client = {
      exec: (sql, cb) => { seen.push(sql); cb(undefined, [{A: 1}]); },
      commit: (cb) => { seen.push("<COMMIT>"); cb(undefined); },
      rollback: (cb) => { seen.push("<ROLLBACK>"); cb(undefined); },
    };
    return {seen, client};
  };

  it("refuses a write before it reaches the driver, kind in the message, never the text", async () => {
    const db = new HanaDatabaseClient({existingSchema: true});
    const fake = fakeDriver();
    db.client = fake.client;
    let error;
    try {
      await db.execute(`INSERT INTO "ZOSD_H1_T" ("A") VALUES ('SECRETVALUE')`);
    } catch (e) { error = e; }
    expect(error?.code, "the refusal carries the HANA_READONLY code").to.equal("HANA_READONLY");
    expect(error.message, "the kind is named").to.include("INSERT");
    expect(error.message, "the statement text stays out").to.not.include("SECRETVALUE");
    expect(error.message, "and the table name with it").to.not.include("ZOSD_H1_T");
    expect(fake.seen, "nothing reached the driver").to.deep.equal([]);
  });

  it("refuses every non-SELECT kind, each named", async () => {
    for (const [sql, kind] of [
      [`UPDATE "T" SET "A" = 1`, "UPDATE"],
      [`DELETE FROM "T" WHERE "A" = 1`, "DELETE"],
      [`MERGE INTO "T" USING ...`, "MERGE"],
      [`UPSERT "T" VALUES (...)`, "UPSERT"],
      [`CREATE TABLE "T" ("A" INT)`, "CREATE"],
      [`DROP TABLE "T"`, "DROP"],
      [`ALTER TABLE "T" ADD ("B" INT)`, "ALTER"],
      [`TRUNCATE TABLE "T"`, "TRUNCATE"],
      [`CALL "ZOSD_H1_PROC"()`, "CALL"],
      // not on the task's list, refused by the default rule: everything that
      // is not an allowed kind is refused, by name
      [`GRANT SELECT ON "T" TO PUBLIC`, "GRANT"],
      [`WITH x AS (SELECT 1 FROM DUMMY) SELECT * FROM x`, "WITH"],
    ]) {
      const db = new HanaDatabaseClient({existingSchema: true});
      const fake = fakeDriver();
      db.client = fake.client;
      let error;
      try { await db.execute(sql); } catch (e) { error = e; }
      expect(error?.code, sql).to.equal("HANA_READONLY");
      expect(error.message, sql).to.include(kind);
      expect(fake.seen, sql).to.deep.equal([]);
    }
  });

  it("lets a SELECT through", async () => {
    const db = new HanaDatabaseClient({existingSchema: true});
    const fake = fakeDriver();
    db.client = fake.client;
    const rows = await db.query(`SELECT "A" FROM "ZOSD_H1_T"`);
    expect(fake.seen.length).to.equal(1);
    expect(rows).to.deep.equal([{a: 1}]);
  });

  it("lets SET SCHEMA and the COMMIT/ROLLBACK bracket through", async () => {
    // SET SCHEMA is what connect() sends, and it is session control, not
    // data access. COMMIT and ROLLBACK are the LUW bracket the runtime
    // always calls (disconnect() commits): allowed, and a no-op while
    // nothing is open -- which is always, because the guard fires before a
    // refused statement could open one. Decided in the task's open question,
    // documented in docs/db-backends.md.
    const db = new HanaDatabaseClient({existingSchema: true});
    const fake = fakeDriver();
    db.client = fake.client;
    await db.execute(`SET SCHEMA "ZOSD_H1_S"`);
    await db.commit();
    await db.rollback();
    // commit() closed the bracket, so the rollback that follows finds
    // nothing open and is the no-op its early return already is
    expect(fake.seen).to.deep.equal([`SET SCHEMA "ZOSD_H1_S"`, "<COMMIT>"]);
  });

  it("does not let insert/update/delete swallow the refusal into subrc 4", async () => {
    // subrc 4 means "the row was not there" to an ABAP caller. A refusal is
    // not that, and hiding it would make a read-only run look like a run
    // whose rows simply never matched.
    for (const call of [
      (db) => db.insert({table: "ZOSD_H1_T", columns: ["A"], values: ["'x'"]}),
      (db) => db.update({table: "ZOSD_H1_T", set: [`"A" = 1`], where: `"A" = 2`}),
      (db) => db.delete({table: "ZOSD_H1_T", where: `"A" = 1`}),
    ]) {
      const db = new HanaDatabaseClient({existingSchema: true});
      const fake = fakeDriver();
      db.client = fake.client;
      let error;
      try { await call(db); } catch (e) { error = e; }
      expect(error?.code, "the refusal propagates").to.equal("HANA_READONLY");
      expect(fake.seen, "and nothing reaches the driver").to.deep.equal([]);
    }
  });

  it("leaves no transaction open behind a refusal", async () => {
    const db = new HanaDatabaseClient({existingSchema: true});
    const fake = fakeDriver();
    db.client = fake.client;
    try { await db.execute(`INSERT INTO "T" ("A") VALUES (1)`); } catch { /* refused */ }
    await db.commit();
    expect(fake.seen, "commit() found nothing open and sent nothing").to.deep.equal([]);
  });

  it("the native channel is guarded too: a lowered write is refused", async () => {
    const db = new HanaDatabaseClient({existingSchema: true});
    const fake = fakeDriver();
    db.client = fake.client;
    let error;
    try { await db.native({sql: `INSERT INTO "T" VALUES (1)`, expect: "none"}); } catch (e) { error = e; }
    expect(error?.code).to.equal("HANA_READONLY");
    expect(fake.seen).to.deep.equal([]);
  });

  it("OSD_HANA_WRITE=1 lifts the guard", async () => {
    process.env.OSD_HANA_WRITE = "1";
    try {
      const db = new HanaDatabaseClient({existingSchema: true});
      const fake = fakeDriver();
      db.client = fake.client;
      await db.insert({table: "ZOSD_H1_T", columns: ["A"], values: ["'x'"]});
      expect(fake.seen[0]).to.include("INSERT INTO");
    } finally {
      delete process.env.OSD_HANA_WRITE;
    }
  });

  it("without the mode the guard is off: the ordinary client still builds its schema", async () => {
    // STG_DB=hana's own path issues CREATE TABLE and seeds; nothing of this
    // slice may change it.
    const db = new HanaDatabaseClient({});
    const fake = fakeDriver();
    db.client = fake.client;
    await db.execute(`CREATE TABLE "ZOSD_H1_T" ("A" INT)`);
    expect(fake.seen.length).to.equal(1);
  });

  it("statementKind reads the first word outside the literals", () => {
    expect(statementKind(`  select * from t`)).to.equal("SELECT");
    expect(statementKind(`SELECT * FROM "T" WHERE "A" = 'INSERT INTO'`)).to.equal("SELECT");
    expect(statementKind(`insert into t values ('x')`)).to.equal("INSERT");
    // a statement that begins inside a literal is not a statement of any
    // kind, and it is refused by that name rather than guessed at
    expect(statementKind(`'INSERT INTO "T" VALUES (1)'`)).to.equal("");
  });
});
