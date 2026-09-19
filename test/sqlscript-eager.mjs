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
import {runBothWays, runFused, runEager, compare, isInvalid} from "../tools/sqlscript-eager.mjs";

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

// The failure mode next door, applied to this instrument: a number that
// measures its own brokenness. If both halves raise, the comparison says
// they agree - which is right when the DATA was rejected and badly wrong
// when the STATEMENT was, because a statement one engine will not parse is
// a defect in the lowering, not a difference between two ways of running.
describe("a refused statement is never agreement", () => {
  it("both raising on the data is agreement, as HANA's own behaviour requires", () => {
    const verdict = compare({raised: "invalid number"}, {raised: "invalid number"});
    expect(verdict.agree).to.equal(true);
    expect(verdict.both).to.equal("raised");
  });

  it("but a syntax or binder error is our defect and must not pass as agreement", () => {
    for (const message of ["Parser Error: syntax error at or near", "Binder Error: column K does not exist",
                           "no such function: TO_INTEGER", "Catalog Error: Table with name SRC does not exist"]) {
      expect(isInvalid(message), message).to.equal(true);
      const verdict = compare({raised: message}, {raised: message});
      expect(verdict.agree, message).to.equal(false);
      expect(verdict.kind).to.equal("statement-refused");
    }
  });

  it("and a real data error is not mistaken for one", () => {
    expect(isInvalid("Conversion Error: Could not convert string 'oops' to INT32")).to.equal(false);
    expect(isInvalid("division by zero undefined")).to.equal(false);
  });
});

// A relation the instrument has to be able to force, and could not.
//
// The refusal on `defineRelation` was written for a **definition**: a view
// carrying bind values would have to keep them alive for as long as the view
// exists. That reason is right, and it does not reach the materialised case,
// where `CREATE TABLE ... AS <select>` consumes the values once at creation
// and what remains is rows. The refusal covered both anyway -- and a literal
// is in almost every real body, so the forced half of the comparison could
// not force nearly anything it claimed to. "No divergences found" would have
// been a statement about how little was forced (fable-osd, 2026-09-19).
describe("a materialised relation may carry its values, and a definition may not", function () {
  this.timeout(30000);
  let client;

  before(async () => {
    client = await duckdb();
  });

  after(async () => {
    await client?.disconnect?.();
  });

  it("materialising with a bound value keeps the value out of the text and the rows right", async () => {
    const handle = await client.defineRelation({
      name: "forced",
      sql: "SELECT k, a FROM src WHERE a >= ?",
      params: [{name: "p0", value: 2, type: "I"}],
      materialise: "forced for the comparison",
    });
    try {
      const {rows} = await client.native({sql: `SELECT k FROM ${client.relationRef(handle)} ORDER BY k`});
      expect(rows.map((r) => r.k)).to.deep.equal(["b", "c"]);
    } finally {
      await client.dropRelation(handle);
    }
  });

  it("but a definition still refuses them, with the reason it refuses for", async () => {
    let failed;
    try {
      await client.defineRelation({name: "def", sql: "SELECT k FROM src WHERE a >= ?", params: [{value: 2, type: "I"}]});
    } catch (error) {
      failed = error;
    }
    expect(failed, "a view carrying bind values must still be refused").to.not.equal(undefined);
    expect(String(failed.message)).to.match(/materialise it, or bind at use/);
  });
});

// The two-step HANA path types its table from HANA's own inference on the
// real statement, so there is nothing here to guess. What is left to test
// without a database is the one translation: a wire type code into a name a
// CREATE TABLE accepts.
//
// The first version guessed instead, from the parameter's declared type, and
// fable-osd named the hazard before it shipped: the column typed by the
// stand-in, the rows arriving from the value, and an expression between them
// able to widen the type. Measured on HANA Express and silent -- with an
// INTEGER stand-in, `? + 1` over 1.5 stored 2 where the fused half answers
// 2.5, so the forced half would have carried a divergence the instrument
// invented. The fix was not a better guess; it was to stop guessing.
describe("a wire type code becomes a type a CREATE TABLE accepts", () => {
  it("carries the size where the type has one, and nothing where it does not", async () => {
    const {hanaColumnType} = await import("../tools/hana-client.mjs");
    expect(hanaColumnType({dataType: 3, length: 10, fraction: 0})).to.equal("INTEGER");
    expect(hanaColumnType({dataType: 11, length: 3, fraction: 0})).to.equal("NVARCHAR(3)");
    expect(hanaColumnType({dataType: 5, length: 16, fraction: 2})).to.equal("DECIMAL(16,2)");
    expect(hanaColumnType({dataType: 14})).to.equal("DATE");
  });

  it("refuses a code it has no name for, rather than inventing a column type", async () => {
    const {hanaColumnType} = await import("../tools/hana-client.mjs");
    expect(() => hanaColumnType({dataType: 999})).to.throw(/no name for HANA type code 999/);
  });

  it("names the columns as the statement displays them, quoted", async () => {
    const {columnsFromMetadata} = await import("../tools/hana-client.mjs");
    expect(columnsFromMetadata([
      {dataType: 3, length: 10, columnDisplayName: "V"},
      {dataType: 11, length: 5, columnName: 'ODD"NAME'},
    ])).to.deep.equal(['"V" INTEGER', '"ODD""NAME" NVARCHAR(5)']);
  });
});

// Written before the first writing body exists, on purpose: the rule is
// cheap now and unaffordable the first time a comparison writes twice into
// a table somebody owns.
describe("a plan that writes is not compared by running it twice", () => {
  it("refuses, and names the table it would have written to twice", async () => {
    const {effects} = await import("../tools/sqlscript-ir.mjs");
    const writing = {rel: "insert", into: "ZTARGET", input: scan("src")};
    expect(effects(writing).writes).to.deep.equal(["ZTARGET"]);
    let refused;
    try {
      await runBothWays({}, writing, "duckdb");
    } catch (error) {
      refused = String(error.message);
    }
    expect(refused, "the refusal must name the table").to.contain("ZTARGET");
    expect(refused).to.contain("would write twice");
  });

  it("and a plan that only reads is compared as before", async () => {
    expect((await import("../tools/sqlscript-ir.mjs")).effects(scan("src")).writes).to.be.empty;
  });
});
