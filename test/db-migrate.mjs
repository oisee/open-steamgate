import {expect} from "chai";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DuckDBInstance} from "@duckdb/node-api";
import {COLUMN_RENAMES, migrateDuckdbColumns, refreshDuckdbViews} from "../tools/osd-db-migrate.mjs";

// ZOSD_TAXIFACT and its SQL view as a build before the rename wrote them into
// a DuckDB file (quoted, NCHAR as VARCHAR, the primary key on the table)
const OLD_TABLE = `CREATE TABLE "zosd_taxifact" ("mandt" VARCHAR(3), "fact_id" VARCHAR(10),
  "pickup_day" VARCHAR(8), "pickup_hour" INT, "borough" VARCHAR(20), "zone" VARCHAR(80),
  "payment" VARCHAR(12), "trips" INT, "fare" DECIMAL(15,2), "tip" DECIMAL(15,2),
  "distance" DECIMAL(15,2), PRIMARY KEY("mandt","fact_id"))`;
const OLD_VIEW = `CREATE VIEW "zvosdtaxicube" AS SELECT "zosd_taxifact".fact_id AS factid,
  "zosd_taxifact".borough AS borough, "zosd_taxifact".zone AS zone FROM "zosd_taxifact"`;
const NEW_VIEW = `CREATE VIEW "zvosdtaxicube" AS SELECT "zosd_taxifact".fact_id AS factid,
  "zosd_taxifact".borough AS borough, "zosd_taxifact".pickup_zone AS zone FROM "zosd_taxifact"`;

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
      expect(await refreshDuckdbViews(db, ["CREATE TABLE ignored (x INT)", NEW_VIEW])).to.equal(1);
      const rows = await db.query("SELECT pickup_zone FROM zosd_taxifact");
      expect(rows.map((row) => row.pickup_zone)).to.deep.equal(["JFK Airport"]);
      const view = await db.query("SELECT factid, zone FROM zvosdtaxicube");
      expect(view).to.deep.equal([{factid: "0000000001", zone: "JFK Airport"}]);
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
});
