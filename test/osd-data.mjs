import {expect} from "chai";
import {Data, NotAllowed} from "../tools/osd-data.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

// The data of OSD: the rows a client sees when it asks for table contents,
// out of the same database the ABAP runtime uses.
describe("tools/osd-data: the rows of the local system", function () {
  this.timeout(60000);
  const data = new Data();

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
});
