// DECLARE with DEFAULT and CONSTANT, and a leading minus -- each row the
// value HANA Express returned for the same body (measured 2026-09-24,
// docs/sqlscript-hana-observed.md).
import {expect} from "chai";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure, UnsupportedSqlScript} from "../tools/sqlscript-procedure-ir.mjs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";

const SIG = {name: "M", kind: "METHOD", parameters: [{name: "ev", direction: "OUT", abapType: "string"}]};
const run = async (body, options = {}) => (await runProcedure(compileProcedure({...SIG, body}, new Map(), {}), options)).value;

describe("DECLARE ... DEFAULT and CONSTANT, as HANA Express ran them", () => {
  for (const [name, body, hana] of [
    ["DEFAULT is the initial value", "DECLARE x INTEGER DEFAULT 5; ev = :x;", "5"],
    ["a CONSTANT with =", "DECLARE x CONSTANT INTEGER = 7; ev = :x;", "7"],
    ["a CONSTANT with DEFAULT", "DECLARE x CONSTANT INTEGER DEFAULT 8; ev = :x;", "8"],
    ["a text with DEFAULT", "DECLARE s NVARCHAR(10) DEFAULT 'ab'; ev = :s;", "ab"],
  ]) it(`${name}: ${JSON.stringify(hana)}`, async () => expect(await run(body)).to.equal(hana));

  it("refuses an assignment to a CONSTANT, as HANA does at CREATE", () => {
    expect(() => compileProcedure({...SIG, body: "DECLARE x CONSTANT INTEGER = 7; x = 2; ev = :x;"}, new Map(), {}))
      .to.throw(UnsupportedSqlScript, /cannot modify constant variable/);
  });
});

describe("a leading minus, as HANA Express ran it", () => {
  it("in a scalar expression: -(-3) + 1 is 4, -(2 + 3) * 2 is -10", async () => {
    expect(await run("DECLARE x INTEGER = -3; ev = -:x + 1;")).to.equal("4");
    expect(await run("DECLARE x INTEGER = 0; x = -(2 + 3) * 2; ev = :x;")).to.equal("-10");
  });
  it("refuses a minus before a text", () => {
    expect(() => compileProcedure({...SIG, body: "DECLARE s NVARCHAR(3) = 'a'; ev = -:s;"}, new Map(), {})).to.throw(/leading minus/);
  });
  for (const [dialect, make] of [["duckdb", () => new DuckDBDatabaseClient({path: ":memory:"})], ["sqlite", () => new FileSqliteClient({path: ":memory:"})]]) {
    it(`in a query, on ${dialect}: SELECT -1, -n`, async () => {
      const client = make();
      await client.connect();
      try {
        const out = await run("DECLARE v NVARCHAR(100) = ''; DECLARE a INTEGER = 0; DECLARE b INTEGER = 0; SELECT -1 AS p, -(2 * 3) AS q INTO a, b FROM DUMMY; ev = :a || ',' || :b;", {client, dialect});
        expect(out).to.equal("-1,-6");
      } finally { await client.disconnect(); }
    });
  }
});
