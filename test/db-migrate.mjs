import {expect} from "chai";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DuckDBInstance} from "@duckdb/node-api";
import {COLUMN_RENAMES, migrateDuckdbColumns, migrateDuckdbFile, refreshDuckdbViews, refuseUnmigratedHana} from "../tools/osd-db-migrate.mjs";
import {setup} from "./setup.mjs";

// ZOSD_TAXIFACT and its SQL view as a build before the rename wrote them into
// a DuckDB file (quoted, NCHAR as VARCHAR, the primary key on the table)
const OLD_TABLE = `CREATE TABLE "zosd_taxifact" ("mandt" VARCHAR(3), "fact_id" VARCHAR(10),
  "pickup_day" VARCHAR(8), "pickup_hour" INT, "borough" VARCHAR(20), "zone" VARCHAR(80),
  "payment" VARCHAR(12), "trips" INT, "fare" DECIMAL(15,2), "tip" DECIMAL(15,2),
  "distance" DECIMAL(15,2), PRIMARY KEY("mandt","fact_id"))`;
const OLD_VIEW = `CREATE VIEW "zvosdtaxicube" AS SELECT "zosd_taxifact".fact_id AS factid,
  "zosd_taxifact".borough AS borough, "zosd_taxifact".zone AS zone FROM "zosd_taxifact"`;
const NEW_VIEW = `CREATE VIEW "zvosdtaxicube" AS SELECT "zosd_taxifact".fact_id AS factid,
  "zosd_taxifact".borough AS borough, "zosd_taxifact".pickup_zone AS pickupzone FROM "zosd_taxifact"`;

async function open(path) {
  const instance = await DuckDBInstance.create(path);
  const connection = await instance.connect();
  return {
    query: async (sql) => (await connection.runAndReadAll(sql)).getRowObjects(),
    execute: (sql) => connection.run(sql),
    close() {
      connection.closeSync();
      instance.closeSync();
    },
  };
}

describe("DuckDB file migration (tools/osd-db-migrate.mjs)", function () {
  this.timeout(30000);
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-db-migrate-"));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  it("names the taxi rename: ZONE is reserved on a system", () => {
    expect(COLUMN_RENAMES).to.deep.include({table: "zosd_taxifact", from: "zone", to: "pickup_zone"});
  });

  it("renames ZONE in a file made before, keeps its rows and key, and is idempotent", async () => {
    const path = join(dir, "old.duckdb");
    let db = await open(path);
    await db.execute(OLD_TABLE);
    await db.execute(OLD_VIEW);
    await db.execute("INSERT INTO zosd_taxifact VALUES ('123','0000000001','20250101',0,'Queens','JFK Airport','Card',1,1,0,1)");
    db.close();

    db = await open(path);
    try {
      expect(await migrateDuckdbColumns(db)).to.deep.equal(["zosd_taxifact.zone -> pickup_zone"]);
      // the view still names "zone" until the running generation's views are put back
      expect(await refreshDuckdbViews(db, ["CREATE TABLE ignored (x INT)", NEW_VIEW])).to.deep.equal({refreshed: 1, foreign: []});
      const rows = await db.query("SELECT pickup_zone FROM zosd_taxifact");
      expect(rows.map((row) => row.pickup_zone)).to.deep.equal(["JFK Airport"]);
      const view = await db.query("SELECT factid, pickupzone FROM zvosdtaxicube");
      expect(view).to.deep.equal([{factid: "0000000001", pickupzone: "JFK Airport"}]);
      try {
        await db.execute("INSERT INTO zosd_taxifact VALUES ('123','0000000001','20250101',0,'Queens','X','Card',1,1,0,1)");
        expect.fail("the primary key should survive the rename");
      } catch (error) {
        expect(String(error.message)).to.match(/constraint|duplicate/i);
      }
    } finally {
      db.close();
    }

    db = await open(path);
    try {
      expect(await migrateDuckdbColumns(db)).to.deep.equal([]);
      const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'zosd_taxifact' ORDER BY ordinal_position");
      expect(columns.map((row) => row.column_name)).to.include("pickup_zone").and.not.include("zone");
    } finally {
      db.close();
    }
  });

  it("does nothing to a file made after the rename, or without the table", async () => {
    const db = await open(join(dir, "new.duckdb"));
    try {
      expect(await migrateDuckdbColumns(db)).to.deep.equal([]);
      await db.execute(OLD_TABLE.replace('"zone"', '"pickup_zone"'));
      expect(await migrateDuckdbColumns(db)).to.deep.equal([]);
    } finally {
      db.close();
    }
  });

  it("refuses a table that has the old and the new column", async () => {
    const db = await open(join(dir, "both.duckdb"));
    try {
      await db.execute(OLD_TABLE);
      await db.execute("ALTER TABLE zosd_taxifact ADD COLUMN pickup_zone VARCHAR(80)");
      try {
        await migrateDuckdbColumns(db);
        expect.fail("both columns should be refused");
      } catch (error) {
        expect(error.message).to.contain("has both zone and pickup_zone");
      }
    } finally {
      db.close();
    }
  });

  it("is one transaction: a failure half-way leaves the old column and the old views", async () => {
    const path = join(dir, "half.duckdb");
    let db = await open(path);
    await db.execute(OLD_TABLE);
    await db.execute(OLD_VIEW);
    db.close();
    db = await open(path);
    try {
      try {
        await migrateDuckdbFile(db, [NEW_VIEW, `CREATE VIEW "broken" AS SELECT nothing FROM "zosd_taxifact"`]);
        expect.fail("the broken view should fail the migration");
      } catch (error) {
        expect(String(error.message)).to.match(/nothing/i);
      }
      const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'zosd_taxifact'");
      expect(columns.map((row) => row.column_name)).to.include("zone").and.not.include("pickup_zone");
      const view = await db.query("SELECT sql FROM duckdb_views() WHERE view_name = 'zvosdtaxicube'");
      expect(view).to.have.length(1);
      expect(view[0].sql).to.match(/zone/).and.not.match(/pickup_zone/);
    } finally {
      db.close();
    }
  });

  it("names the views the running generation does not have and leaves them", async () => {
    const db = await open(join(dir, "foreign.duckdb"));
    try {
      await db.execute(OLD_TABLE);
      await db.execute(`CREATE VIEW "zv_gone" AS SELECT fact_id FROM "zosd_taxifact"`);
      const result = await migrateDuckdbFile(db, [NEW_VIEW]);
      expect(result).to.deep.equal({renamed: ["zosd_taxifact.zone -> pickup_zone"], refreshed: 1, foreign: ["zv_gone"]});
    } finally {
      db.close();
    }
  });

  it("refuses a kept HANA schema that still has the old column, naming the way out", async () => {
    const rows = [{table_name: "ZOSD_TAXIFACT", column_name: "ZONE"}, {table_name: "ZOSD_TAXIFACT", column_name: "FACT_ID"}];
    try {
      await refuseUnmigratedHana({query: async () => rows}, "OSD");
      expect.fail("an unmigrated HANA schema should be refused");
    } catch (error) {
      expect(error.message).to.contain("zosd_taxifact.zone (now pickup_zone)").and.contain("STG_DB_FRESH=1");
    }
    await refuseUnmigratedHana({query: async () => [{table_name: "ZOSD_TAXIFACT", column_name: "PICKUP_ZONE"}]}, "OSD");
  });
});

// The same, through the setup every host passes (test/setup.mjs, STG_DB=duckdb
// with STG_DB_PATH): the wiring, and the order of the schema check before the
// migration.
describe("DuckDB file migration through test/setup.mjs", function () {
  this.timeout(60000);
  const saved = {};
  let dir;
  const TABLES = [`CREATE TABLE "zstg_demo" ("id" VARCHAR)`, OLD_TABLE.replace('"zone"', '"pickup_zone"')];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-db-setup-"));
    for (const name of ["STG_DB", "STG_DB_PATH"]) saved[name] = process.env[name];
  });
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, {recursive: true, force: true});
  });

  async function oldFile(path, {withTaxi = true} = {}) {
    const db = await open(path);
    await db.execute(TABLES[0]);
    if (withTaxi) {
      await db.execute(OLD_TABLE);
      await db.execute(OLD_VIEW);
      await db.execute("INSERT INTO zosd_taxifact VALUES ('123','0000000001','20250101',0,'Queens','JFK Airport','Card',1,1,0,1)");
    }
    db.close();
  }

  async function boot(path, abap = {context: {databaseConnections: {}, RFCDestinations: {}}, builtin: {}}) {
    process.env.STG_DB = "duckdb";
    process.env.STG_DB_PATH = path;
    await setup(abap, {pg: [...TABLES, NEW_VIEW]}, []);
    return abap.context.databaseConnections.DEFAULT;
  }

  it("opens a file made before the rename and serves the renamed column through the new view", async () => {
    const path = join(dir, "old.duckdb");
    await oldFile(path);
    const db = await boot(path);
    try {
      expect(await db.query("SELECT factid, pickupzone FROM zvosdtaxicube")).to.deep.equal([{factid: "0000000001", pickupzone: "JFK Airport"}]);
    } finally {
      await db.disconnect();
    }
  });

  it("says a table is missing before it touches the views", async () => {
    const path = join(dir, "short.duckdb");
    await oldFile(path, {withTaxi: false});
    let db = await open(path);
    await db.execute(`CREATE VIEW "zv_keep" AS SELECT id FROM "zstg_demo"`);
    db.close();
    const abap = {context: {databaseConnections: {}, RFCDestinations: {}}, builtin: {}};
    try {
      await boot(path, abap);
      expect.fail("a missing table should be refused");
    } catch (error) {
      expect(error.message).to.contain("missing generated tables: ZOSD_TAXIFACT");
    } finally {
      await abap.context.databaseConnections.DEFAULT?.disconnect();
    }
    db = await open(path);
    try {
      expect(await db.query("SELECT view_name FROM duckdb_views() WHERE view_name = 'zv_keep'")).to.have.length(1);
    } finally {
      db.close();
    }
  });
});
