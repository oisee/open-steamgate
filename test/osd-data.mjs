import {expect} from "chai";
import {existsSync} from "node:fs";
import {Data, NotAllowed, openSqlToSql} from "../tools/osd-data.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

// The data of OSD: the rows a client sees when it asks for table contents,
// out of the same database the ABAP runtime uses.
describe("tools/osd-data: the rows of the local system", function () {
  this.timeout(120000);
  const data = new Data();

  // the cross-reference rows are derived and git-ignored, so a fresh
  // checkout has none until they are built; this test reads them
  before(async () => {
    if (existsSync("data/wbcrossgt.tabu.json") === false) {
      const {CrossReference} = await import("../tools/osd-xref.mjs");
      new CrossReference().build().write();
    }
  });

  it("the system has its tables: ours, the runtime's own, and the cross-reference", async () => {
    const tables = await data.tables();
    expect(tables).to.include("ZSTG_DEMO");
    expect(tables).to.include("CROSS");
    expect(tables).to.include("WBCROSSGT");
    // the runtime carries a system's own catalogue too
    expect(tables).to.include("TADIR");
    expect(tables.length).to.be.greaterThan(50);
  });

  it("reads a table, with the trailing blanks of a CHAR column gone", async () => {
    const answer = await data.table("zstg_demo", {max: 10});
    expect(answer.columns).to.include("travel_id");
    expect(answer.rows.length).to.be.greaterThan(2);
    const first = answer.rows.find((r) => r.travel_id === "T0001");
    expect(first.description).to.equal("Berlin to Copenhagen");
  });

  it("answers the query vsp's graph tools make, word for word", async () => {
    const answer = await data.query("SELECT INCLUDE, NAME FROM WBCROSSGT WHERE NAME LIKE 'CL_ABAP_Z%'");
    expect(answer.rows.map((r) => `${r.name} <- ${r.include}`)).to.include("CL_ABAP_ZIP <- ZCL_STG_SEGW_REPO");
    const calls = await data.query("SELECT INCLUDE FROM CROSS WHERE TYPE = 'F' AND NAME = 'BAPI_TRANSACTION_COMMIT'");
    expect(calls.rows.length).to.be.greaterThan(0);
  });

  it("Open SQL in, SQL out: a comma-less field list and UP TO n ROWS, the way Eclipse writes them", async () => {
    // recorded from Eclipse ADT 3.60 on F8 (.local/capture/live): the
    // preview writes the field list without commas, as a 7.x report does
    expect(openSqlToSql("SELECT T~A T~B FROM T")).to.equal("SELECT T~A, T~B FROM T");
    expect(openSqlToSql("SELECT A, B FROM T"), "commas stay").to.equal("SELECT A, B FROM T");
    expect(openSqlToSql("SELECT * FROM T"), "a star is not a list").to.equal("SELECT * FROM T");
    expect(openSqlToSql("SELECT A FROM T"), "one field is not a list").to.equal("SELECT A FROM T");
    expect(openSqlToSql("SELECT A B FROM T UP TO 5 ROWS")).to.equal("SELECT A, B FROM T LIMIT 5");
    const rows = await data.query("SELECT WBCROSSGT~INCLUDE WBCROSSGT~NAME FROM WBCROSSGT UP TO 2 ROWS");
    expect(rows.rows.length).to.equal(2);
  });

  it("the row limit is applied here, not trusted to the statement", async () => {
    const two = await data.query("SELECT * FROM wbcrossgt", {max: 2});
    expect(two.rows.length).to.equal(2);
    expect(two.truncated).to.equal(true);
    expect(two.sql).to.contain("LIMIT 2");
    // a statement that carries its own limit keeps it
    const own = await data.query("SELECT * FROM wbcrossgt LIMIT 3", {max: 100});
    expect(own.rows.length).to.equal(3);
  });

  it("only a read is allowed through here", async () => {
    for (const sql of ["DELETE FROM zstg_demo", "UPDATE zstg_demo SET status = 'X'", "DROP TABLE zstg_demo"]) {
      let error;
      try {
        await data.query(sql);
      } catch (e) {
        error = e;
      }
      expect(error, sql).to.be.instanceOf(NotAllowed);
      expect(error.code).to.equal("NOT_ALLOWED");
    }
    // and nothing was deleted
    expect((await data.table("zstg_demo")).rows.length).to.be.greaterThan(2);
  });

  it("the store hands out the same data layer, so the façade has one door", async () => {
    const store = new ObjectStore();
    expect(store.data()).to.equal(store.data());
    const answer = await store.data().query("SELECT status, status_text FROM zstg_status");
    expect(answer.rows.map((r) => r.status)).to.include("A");
  });

  it("a caller that already has a runtime hands in its connection", async () => {
    const client = await data.boot();
    const second = new Data({client});
    // no second boot: the same connection answers
    expect(await second.boot()).to.equal(client);
    expect((await second.query("SELECT status FROM zstg_status")).rows.length).to.be.greaterThan(0);
  });
});
