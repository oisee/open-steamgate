// The instrument pointed at bodies, not at plans somebody already understood.
//
// Until the front end existed, fused-against-forced could only be given a
// plan built by hand - and a hand-built plan is one whose answer its author
// already knew. These are bodies as a person would type them, so the
// comparison is doing the thing it was built for.
import {expect} from "chai";
import {checkBody, planOf, plantHazards, runOnInventedTables} from "../tools/sqlscript-check.mjs";
import {CATALOGUE} from "../tools/sqlscript/end-to-end.mjs";

const FIXTURE = [
  `CREATE TABLE "SRC" ("K" VARCHAR, "N" INTEGER)`,
  `INSERT INTO "SRC" VALUES ('a', 1)`,
  `INSERT INTO "SRC" VALUES ('b', 2)`,
  `INSERT INTO "SRC" VALUES ('c', 3)`,
];

describe("fused against forced, on bodies rather than plans", function () {
  this.timeout(30000);
  let client;

  before(async () => {
    const {DuckDBDatabaseClient} = await import("../tools/duckdb-client.mjs");
    client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    for (const statement of FIXTURE) await client.native({sql: statement, expect: "none"});
    expect(client.supportsNative, "without the native channel this suite measures nothing").to.equal(true);
  });

  after(async () => {
    await client?.disconnect?.();
  });

  it("a chain of assignments is one statement fused and several forced", async () => {
    const body = `lt = SELECT k, n FROM src WHERE n > 1;
                  SELECT k, n FROM :lt ORDER BY k;`;
    const result = await checkBody(client, body, "duckdb");
    expect(result.fused.statements, "fused").to.equal(1);
    expect(result.eager.statements, "forced").to.be.greaterThan(1);
  });

  it("and the two agree, so fusing this body changes nothing observable", async () => {
    const body = `lt = SELECT k, n FROM src WHERE n > 1;
                  SELECT k, n FROM :lt ORDER BY k;`;
    const result = await checkBody(client, body, "duckdb");
    expect(result.agree, JSON.stringify({fused: result.fused, eager: result.eager}, null, 1)).to.equal(true);
    expect(result.fused.rows.map((r) => r.K ?? r.k)).to.deep.equal(["b", "c"]);
  });

  it("a body is parsed into a plan with no variable left in it", async () => {
    const rel = planOf(`lt = SELECT k FROM src;
                        SELECT k FROM :lt;`);
    const seen = [];
    const walk = (r) => {
      if (r === undefined) return;
      seen.push(r.rel);
      for (const key of ["input", "left", "right"]) walk(r[key]);
      for (const one of r.inputs ?? []) walk(one);
    };
    walk(rel);
    expect(seen, "an unresolved variable would mean the binder did not run").to.not.contain("var");
    expect(seen.filter((one) => one === "scan"), "one table, read once").to.have.length(1);
  });
});

describe("the data the plan asks for, and what it finds", function () {
  this.timeout(30000);
  let client;

  beforeEach(async () => {
    const {DuckDBDatabaseClient} = await import("../tools/duckdb-client.mjs");
    client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    for (const statement of FIXTURE) await client.native({sql: statement, expect: "none"});
  });

  afterEach(async () => {
    await client?.disconnect?.();
  });

  it("a body with nothing hazardous in it asks for no rows, so the instrument stays quiet", async () => {
    const rel = planOf(`SELECT k FROM src;`);
    const {planted} = await plantHazards(client, rel, {table: "SRC", schema: CATALOGUE.SRC});
    expect(planted).to.be.empty;
  });

  // The whole point, in one test: representative data hides the divergence,
  // and data derived from the plan exposes it. Same body, same engine, same
  // instrument - only the rows differ.
  //
  // The table is the test's own, because the shared fixture has no column
  // whose plausible values convert and whose hazard value does not, and
  // writing the test against a body that already raises on ordinary rows
  // would have proved nothing. The first attempt did exactly that and the
  // "quiet" run was already raising - which is how it was noticed.
  it("a conversion behind a filter agrees on plausible data and DIFFERS on the row the plan asked for", async () => {
    const schema = {N: {abap: "I"}, TXT: {abap: "STRING"}};
    const catalogue = {SRC2: schema};
    await client.native({sql: `CREATE TABLE "SRC2" ("N" INTEGER, "TXT" VARCHAR)`, expect: "none"});
    for (const [n, txt] of [[1, "1"], [2, "2"], [3, "3"]]) {
      await client.native({sql: `INSERT INTO "SRC2" VALUES (?, ?)`, expect: "none",
        params: [{name: "n", value: n, type: "I"}, {name: "t", value: txt, type: "STRING"}]});
    }

    // numeric comparison on purpose: a string literal would be bound, and a
    // step carrying a bound value cannot be forced into a definition at all
    // (the seam says "bind at use"), so the comparison would have nothing to
    // force and would agree for the wrong reason
    const body = `lt = SELECT n, TO_INTEGER(txt) AS num FROM src2;
                  SELECT num FROM :lt WHERE n <> 9;`;
    const rel = planOf(body, catalogue);

    const quiet = await checkBody(client, body, "duckdb", catalogue);
    expect(quiet.agree, "plausible rows all convert: the comfortable, useless answer").to.equal(true);
    expect(quiet.notForced, "and every step really was forced").to.equal(undefined);

    // the plan names the hazardous column itself; N = 9 is the caller's
    // knowledge of the body, which is what `fill` is for - the row has to be
    // one the filter removes, or both runs raise and nothing is learnt
    const {planted} = await plantHazards(client, rel, {table: "SRC2", schema, fill: {N: 9}});
    expect(planted.map((one) => one.column)).to.deep.equal(["TXT"]);

    const loud = await checkBody(client, body, "duckdb", catalogue);
    expect(loud.agree, JSON.stringify({fused: loud.fused, eager: loud.eager}, null, 1)).to.equal(false);
    expect(loud.kind).to.equal("fused-answers-eager-raises");
    expect(loud.fused.rows, "fused never evaluates the conversion on the removed row").to.have.length(3);
  });
});

// This block was written to pin a known gap: a step carrying a bound value
// could not be forced, because `defineRelation` refused values outright. It
// said "the day it changes, this says so" -- and the day was the same day.
// The seam now accepts values when the relation is MATERIALISED, since
// `CREATE TABLE ... AS <select>` consumes them once (docs/db-seam-native.md),
// so the gap is closed and this asserts the closure instead of the gap. The
// honest-fallback machinery stays, and is tested below against a client that
// refuses, because a seam that refuses is still a seam we may meet.
describe("a step carrying a bound value is forced now, and a refusal is still reported", function () {
  this.timeout(30000);
  let client;

  before(async () => {
    const {DuckDBDatabaseClient} = await import("../tools/duckdb-client.mjs");
    client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    for (const statement of FIXTURE) await client.native({sql: statement, expect: "none"});
  });

  after(async () => {
    await client?.disconnect?.();
  });

  it("a bound literal no longer leaves the step fused", async () => {
    // a string literal is bound, never interpolated - and that used to mean
    // the step could not be forced at all, which is most real bodies
    const body = `lt = SELECT k, n FROM src WHERE k <> 'x';
                  SELECT k FROM :lt;`;
    const result = await checkBody(client, body, "duckdb");
    expect(result.notForced ?? [], "every step was forced, so nothing is reported unforced")
      .to.have.length(0);
    expect(result.agree).to.equal(true);
  });

  it("but a client that refuses is still reported, next to the verdict", async () => {
    // the fallback is not dead code: a seam may refuse for its own reasons,
    // and "they agree" means less when some steps were never forced
    const refusing = Object.create(client);
    refusing.defineRelation = async (request) => {
      if ((request.params ?? []).length > 0) {
        throw new Error("defineRelation: params are not supported on a definition; materialise it, or bind at use");
      }
      return client.defineRelation(request);
    };
    const body = `lt = SELECT k, n FROM src WHERE k <> 'x';
                  SELECT k FROM :lt;`;
    const result = await checkBody(refusing, body, "duckdb");
    expect(result.notForced, "the fact belongs next to the verdict, not buried in the eager half")
      .to.be.an("array").with.length.greaterThan(0);
    expect(result.notForced[0].params).to.be.greaterThan(0);
    expect(result.agree).to.equal(true);
  });
});

// The bodies that could be compared were the ones reading nothing but their
// parameters, and none of those could diverge - a body that casts or divides
// reads a table. These run such a body anyway, against a table built from
// the body itself.
describe("a body that reads a table, run against a table invented from it", function () {
  this.timeout(30000);
  let client;

  beforeEach(async () => {
    const {DuckDBDatabaseClient} = await import("../tools/duckdb-client.mjs");
    client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
  });

  afterEach(async () => {
    await client?.disconnect?.();
  });

  it("builds the table from the body, types each column by its use, and plants the hazard", async () => {
    const body = `lt = SELECT TO_INTEGER(txt) AS num FROM other WHERE n <> 9;
                  SELECT num FROM :lt;`;
    const rel = planOf(body, {OTHER: {}});
    const result = await runOnInventedTables(client, rel, "duckdb");

    expect(result.skipped, "the table is invented, so nothing should be skipped").to.equal(undefined);
    // the plan said TXT holds text, because it is cast to a number
    expect(result.invented.columns.TXT.abap).to.equal("STRING");
    expect(result.planted.map((one) => one.column)).to.deep.equal(["TXT"]);
    // and both halves ran: a verdict, not a scaffolding failure
    expect(result.agree, JSON.stringify(result, null, 1)).to.be.a("boolean");
    // on this body DuckDB evaluates the cast in both halves, so they agree by
    // both raising - a real answer about this body, not a divergence. The
    // shape that DOES diverge is the one above, where the filter sits in an
    // outer select: the engine can push it under the projection there and
    // cannot here, and that difference is the whole subject.
    expect(result.both ?? result.kind).to.equal("raised");
  });

  it("refuses rather than inventing when a column cannot be attributed to a table", async () => {
    const body = `SELECT k FROM a, b WHERE k = 1;`;
    const result = await runOnInventedTables(client, planOf(body, {}), "duckdb");
    expect(result.skipped, "two tables, and a bare column name").to.contain("cannot be attributed");
  });

  it("says so when the plan reads no table at all", async () => {
    const result = await runOnInventedTables(client, planOf(`SELECT 1 AS v FROM dummy;`, {}), "duckdb");
    expect(result.skipped).to.be.a("string");
  });
});
