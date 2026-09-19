// The comparison that finds fusion defects, tested on the case that has one.
//
// HANA measured (docs/sqlscript-hana-observed.md): an assignment to a table
// variable is not an observable barrier, and the same body DOES fail under
// NO_INLINE. So fusing and forcing are two different programs, both of them
// defensible, and the only unacceptable state is not knowing which one ran.
//
// This suite asserts that the instrument can tell them apart on our own
// engines - which is the precondition for trusting it anywhere else.
import {expect} from "chai";
import {T, col, lit, bin, cast, scan, filter, project, order} from "../tools/sqlscript-ir.mjs";
import {runBothWays, runFused, runEager} from "../tools/sqlscript-eager.mjs";

const FIXTURE = [
  `CREATE TABLE src (k VARCHAR, txt VARCHAR, a INTEGER)`,
  `INSERT INTO src VALUES ('a', '1', 1)`,
  `INSERT INTO src VALUES ('b', 'oops', 2)`,
  `INSERT INTO src VALUES ('c', '3', 3)`,
];

async function duckdb() {
  const {DuckDBDatabaseClient} = await import("../tools/duckdb-client.mjs");
  const client = new DuckDBDatabaseClient({path: ":memory:"});
  await client.connect();
  for (const statement of FIXTURE) await client.native({sql: statement, expect: "none"});
  return client;
}

describe("fused against forced: the instrument, on the case that differs", function () {
  this.timeout(30000);
  let client;

  before(async () => {
    client = await duckdb();
    expect(client.supportsNative, "DuckDB must offer the native channel or this measures nothing").to.equal(true);
  });

  after(async () => {
    await client?.disconnect?.();
  });

  // The shape HANA was asked about: a projection that can raise, and a later
  // filter that removes the row which would have raised.
  const dangerous = filter(
    project(scan("src"), [{as: "N", expr: cast(col("txt"), T.int)}, {as: "K", expr: col("k")}]),
    bin("<>", col("K"), lit("b", T.char(1)), T.bool));

  it("fused answers and forced raises, which is the whole reason the instrument exists", async () => {
    const result = await runBothWays(client, dangerous, "duckdb");
    expect(result.agree, JSON.stringify(result, null, 1)).to.equal(false);
    expect(result.kind).to.equal("fused-answers-eager-raises");
    // and the fused half is the one that matches HANA, which answered rows
    expect(result.fused.rows.map((r) => r.K ?? r.k).sort()).to.deep.equal(["a", "c"]);
  });

  it("a plan with nothing that can raise agrees both ways, so the instrument is quiet", async () => {
    const safe = order(project(filter(scan("src"), bin(">", col("a"), lit(0, T.int), T.bool)),
                               [{as: "K", expr: col("k")}]), [{col: "K"}]);
    const result = await runBothWays(client, safe, "duckdb");
    expect(result.agree, JSON.stringify(result, null, 1)).to.equal(true);
    expect(result.both).to.equal("rows");
  });

  it("the two halves really are one statement and several", async () => {
    const safe = order(project(scan("src"), [{as: "K", expr: col("k")}]), [{col: "K"}]);
    const fused = await runFused(client, safe, "duckdb");
    const eager = await runEager(client, safe, "duckdb");
    expect(fused.statements, "fused is one statement").to.equal(1);
    expect(eager.statements, "forced is one per step plus the read").to.be.greaterThan(1);
  });

  it("forced execution leaves nothing behind, or the next run measures the last one", async () => {
    const safe = project(scan("src"), [{as: "K", expr: col("k")}]);
    const first = await runEager(client, safe, "duckdb");
    const second = await runEager(client, safe, "duckdb");
    expect(first.raised, JSON.stringify(first)).to.equal(undefined);
    expect(second.raised, "a name collision here means the relations were not dropped").to.equal(undefined);
  });

  // The effects walker is what a barrier decision reads, so it has to agree
  // with what the engines actually do: it marks this plan as able to raise,
  // and the plan does raise when forced.
  it("what the IR says can raise is what does raise when forced", async () => {
    const {effects} = await import("../tools/sqlscript-ir.mjs");
    expect(effects(dangerous).mayThrow).to.equal(true);
    const eager = await runEager(client, dangerous, "duckdb");
    expect(eager.raised, "the IR promised this could raise").to.be.a("string");
  });
});
