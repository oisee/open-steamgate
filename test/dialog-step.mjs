// One dialog step at a time (tools/osd-dialog-step.mjs). Every step shares
// the one connection and so the one LUW; on an engine that answers on a
// macrotask -- DuckDB here, PostgreSQL and HANA alike -- two overlapping
// steps used to share it too, and a step that dumped rolled back the
// half-written rows of the step beside it, which then committed and
// answered as if its write were whole. These run the steps against DuckDB
// with nothing of the ABAP around them: the host's rule, alone.
import {expect} from "chai";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {dialogStep, exclusive, workProcess} from "../tools/osd-dialog-step.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("a dialog step has the work process to itself", function () {
  this.timeout(20000);
  let client;
  let saved;
  let subrc;
  let runtimeWaits;
  beforeEach(async () => {
    saved = globalThis.abap;
    client = new DuckDBDatabaseClient();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "R" ("ID" INTEGER)', expect: "none"});
    subrc = [];
    runtimeWaits = 0;
    globalThis.abap = {
      context: {databaseConnections: {DEFAULT: client}},
      // the runtime's own WAIT, counted: inside a step the host's takes over
      statements: {wait: async () => { runtimeWaits += 1; }},
      builtin: {sy: {get: () => ({subrc: {set: (value) => subrc.push(value)}})}},
    };
  });
  afterEach(async () => {
    globalThis.abap = saved;
    await client.disconnect();
    // a case that left the work process held would hang every case after it
    expect(workProcess(), "the work process is free after the case").to.deep.include({held: false, waiting: 0});
  });
  const insert = (id) => client.write({sql: `INSERT INTO "R" VALUES (${id})`});
  const ids = async () => (await client.native({sql: 'SELECT "ID" FROM "R" ORDER BY "ID"', expect: "rows"})).rows.map((r) => Number(r.ID));

  it("a step that dumps does not roll back the half-written rows of the step beside it", async () => {
    const order = [];
    let firstRowWritten;
    const written = new Promise((resolve) => { firstRowWritten = resolve; });
    // A: a deep insert -- one row, a wait on the database, the next row
    const a = dialogStep(async () => {
      await insert(1);
      firstRowWritten();
      await sleep(50);
      await insert(2);
      order.push("A done");
    });
    // B arrives while A is half-way and dumps
    await written;
    const b = dialogStep(async () => {
      order.push("B runs");
      throw new Error("a dump nobody declared");
    });
    await a;
    await b.catch(() => undefined);
    expect(await ids(), "A's write, whole").to.deep.equal([1, 2]);
    expect(order, "B waited for A's step to end").to.deep.equal(["A done", "B runs"]);
  });

  it("a step in a WAIT commits its own LUW and lets the others run meanwhile", async () => {
    const order = [];
    let waiting;
    const inWait = new Promise((resolve) => { waiting = resolve; });
    const a = dialogStep(async () => {
      await insert(1);
      const wait = globalThis.abap.statements.wait({seconds: {get: () => 0.2}});
      waiting();
      await wait;
      order.push("A after its WAIT");
      throw new Error("A dumps after the WAIT");
    });
    await inWait;
    const b = dialogStep(async () => {
      await insert(3);
      order.push("B done");
    });
    await b;
    await a.catch(() => undefined);
    expect(order, "B ran inside A's WAIT").to.deep.equal(["B done", "A after its WAIT"]);
    // 1 was committed by the WAIT, as a system's WAIT ends the LUW; 3 is B's
    expect(await ids()).to.deep.equal([1, 3]);
    expect(subrc).to.deep.equal([0]);
  });

  it("a WAIT whose condition is already true keeps the work process and commits nothing", async () => {
    await dialogStep(async () => {
      await insert(1);
      await globalThis.abap.statements.wait({seconds: {get: () => 1}, cond: () => true});
      throw new Error("dumps: the row was never committed");
    }).catch(() => undefined);
    expect(await ids()).to.deep.equal([]);
    expect(subrc).to.deep.equal([0]);
  });

  it("a commit that fails inside a WAIT ends that step and not the process", async () => {
    // the #75 critic's hang: the flag said "released" before the commit ran,
    // so a failed commit re-acquired a lock it still held
    const commit = client.commit.bind(client);
    let failOnce = true;
    client.commit = async () => {
      if (failOnce) { failOnce = false; throw new Error("could not serialize access"); }
      return commit();
    };
    let flag = false;
    const a = dialogStep(async () => {
      await insert(1);
      await globalThis.abap.statements.wait({seconds: {get: () => 1}, cond: () => flag});
    });
    const outcome = await a.then(() => "committed", (e) => String(e.message));
    expect(outcome).to.equal("could not serialize access");
    await dialogStep(async () => { await insert(2); });
    expect(await ids(), "the failed step rolled back, the next one ran").to.deep.equal([2]);
    expect(runtimeWaits).to.equal(0);
  });

  it("a WAIT outside any step is the runtime's own and leaves the step that holds the work process alone", async () => {
    let inStep;
    const holding = new Promise((resolve) => { inStep = resolve; });
    const order = [];
    const a = dialogStep(async () => {
      await insert(1);
      inStep();
      await sleep(60);
      order.push("A done");
    });
    await holding;
    // not inside A: it must not commit A's LUW nor hand A's work process on
    await globalThis.abap.statements.wait({seconds: {get: () => 0.01}});
    const b = dialogStep(async () => { order.push("B runs"); });
    await Promise.all([a, b]);
    expect(runtimeWaits, "the runtime's WAIT answered it").to.equal(1);
    expect(order).to.deep.equal(["A done", "B runs"]);
  });

  it("a step inside a step is refused by name rather than waiting for itself", async () => {
    const outcome = await dialogStep(() => dialogStep(async () => undefined, "the inner one"))
      .then(() => "ran", (e) => String(e.message));
    expect(outcome).to.match(/a nested dialog step \(the inner one\)/);
    const read = await dialogStep(() => exclusive(async () => undefined, "a read")).then(() => "ran", (e) => String(e.message));
    expect(read).to.match(/a nested dialog step \(a read\)/);
  });

  it("a read of the shared connection waits for the step in progress", async () => {
    let started;
    const inStep = new Promise((resolve) => { started = resolve; });
    const step = dialogStep(async () => {
      await insert(1);
      started();
      await sleep(50);
      await insert(2);
    });
    await inStep;
    // what /osd/sql does: it must not see the step half-way
    const seen = await exclusive(ids);
    await step;
    expect(seen).to.deep.equal([1, 2]);
  });
});
