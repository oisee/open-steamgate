import {expect} from "chai";
import {SQLiteDatabaseClient} from "@abaplint/database-sqlite";
import {existsSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fingerprintOf, loadInto, save, stamp} from "../tools/osd-persist.mjs";

// Where the rows live when the process holding them is replaced, and what
// happens when the rows were made for other tables. Source versions in git
// and data versions in this file, and the two can disagree: a worktree per
// experiment is the workflow, so a database from one branch meeting another
// branch's DDIC is a thing that will happen rather than a thing that might.
describe("tools/osd-persist: a database that outlives its process", function () {
  this.timeout(60000);

  const SCHEMA = ["CREATE TABLE 'ztest' ('mandt' NCHAR(3), 'id' NCHAR(4), 'text' TEXT);"];
  const OTHER = ["CREATE TABLE 'ztest' ('mandt' NCHAR(3), 'id' NCHAR(4), 'text' TEXT, 'extra' INT);"];

  let folder;
  let file;
  let planted = false;

  before(() => {
    // the SQLite client touches the runtime's globals when it connects, to
    // set sy-dbsys. There is no runtime here, and a suite that booted one
    // must not have it taken away, so only an absence is filled.
    if (globalThis.abap === undefined) {
      globalThis.abap = {};
      planted = true;
    }
  });

  after(() => {
    if (planted === true) {
      delete globalThis.abap;
    }
  });

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "osd-persist-"));
    file = join(folder, "osd.sqlite");
    process.env.STG_DB_PATH = file;
  });

  afterEach(() => {
    delete process.env.STG_DB_PATH;
    rmSync(folder, {recursive: true, force: true});
  });

  const build = async (schema) => {
    const db = new SQLiteDatabaseClient();
    const restored = await loadInto(db, schema);
    if (restored === false) {
      await db.execute(schema);
      await stamp(db, schema);
    }
    return {db, restored};
  };

  it("a row written into one database is read out of the next", async () => {
    const first = await build(SCHEMA);
    expect(first.restored).to.equal(false);
    await first.db.execute("INSERT INTO ztest ('mandt','id','text') VALUES ('123','0001','a row that should survive');");
    expect(save(first.db)).to.include({file});
    expect(existsSync(file)).to.equal(true);

    const second = await build(SCHEMA);
    expect(second.restored, "the same schema must not be seeded over").to.equal(true);
    const answer = await second.db.select({select: "SELECT text FROM ztest WHERE id = '0001'"});
    expect(answer.rows[0].text).to.equal("a row that should survive");
  });

  it("a database made for other tables is not served as if it fitted", async () => {
    const first = await build(SCHEMA);
    await first.db.execute("INSERT INTO ztest ('mandt','id','text') VALUES ('123','0002','made for the old tables');");
    save(first.db);

    // the same file, a schema that differs by one column, which is what a
    // branch with its own DDIC looks like from here
    const second = await build(OTHER);
    expect(second.restored, "a file for another schema has to be rebuilt").to.equal(false);
    const answer = await second.db.select({select: "SELECT count(*) as n FROM ztest"});
    expect(Number(answer.rows[0].n), "the old rows must not come back under the new tables").to.equal(0);
    // and the new database knows what it was made for
    const written = await second.db.select({select: "SELECT fingerprint FROM osd_schema"});
    expect(written.rows[0].fingerprint).to.equal(fingerprintOf(OTHER));
  });

  it("strict means the human chooses, and nothing is touched", async () => {
    const first = await build(SCHEMA);
    await first.db.execute("INSERT INTO ztest ('mandt','id','text') VALUES ('123','0003','worth a look before it goes');");
    save(first.db);

    process.env.STG_DB_STRICT = "1";
    try {
      const db = new SQLiteDatabaseClient();
      let refused;
      try {
        await loadInto(db, OTHER);
      } catch (error) {
        refused = error;
      }
      expect(refused?.code).to.equal("SCHEMA_DRIFT");
      expect(refused.message).to.contain("STG_DB_STRICT");
    } finally {
      delete process.env.STG_DB_STRICT;
    }

    // the file is still there with its row in it, which is the point of
    // refusing rather than rebuilding
    const again = await build(SCHEMA);
    expect(again.restored).to.equal(true);
    const answer = await again.db.select({select: "SELECT text FROM ztest WHERE id = '0003'"});
    expect(answer.rows[0].text).to.equal("worth a look before it goes");
  });

  it("a fingerprint is of the schema and nothing else", () => {
    expect(fingerprintOf(SCHEMA)).to.equal(fingerprintOf([...SCHEMA]));
    expect(fingerprintOf(SCHEMA)).to.not.equal(fingerprintOf(OTHER));
    expect(fingerprintOf(SCHEMA)).to.have.lengthOf(16);
    // an array and the text it joins to are the same schema
    expect(fingerprintOf(SCHEMA)).to.equal(fingerprintOf(SCHEMA.join("\n")));
  });

  it("without a path nothing is written and nothing is expected", async () => {
    delete process.env.STG_DB_PATH;
    const db = new SQLiteDatabaseClient();
    expect(await loadInto(db, SCHEMA), "no file means build it").to.equal(false);
    await db.execute(SCHEMA);
    expect(await stamp(db, SCHEMA), "nothing to stamp without a file").to.equal(undefined);
    expect(save(db), "nothing to save without a file").to.equal(undefined);
  });
});
