// The instrument pointed at bodies, not at plans somebody already understood.
//
// Until the front end existed, fused-against-forced could only be given a
// plan built by hand - and a hand-built plan is one whose answer its author
// already knew. These are bodies as a person would type them, so the
// comparison is doing the thing it was built for.
import {expect} from "chai";
import {checkBody, planOf} from "../tools/sqlscript-check.mjs";

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
