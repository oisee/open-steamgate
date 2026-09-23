// The A4H replay: foreman-dell's measurement on A4H (a throwaway table of its
// own, 31 rows, 80 cases; test/fixtures/ir-pairs/a4h-ranges.json holds only
// that table's own data) run through rangesPredicate on DuckDB and SQLite.
// Every case either selects exactly A4H's rows, raises what A4H raised
// (a dump or a catchable exception, by name), or is refused by name. A
// different set of rows -- a silent wrong answer -- fails the test.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {rangesPredicate, RangesDump, RangesDataError, RangesError} from "../tools/ir-ranges.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";
import {filter, scan, project, col} from "../tools/sqlscript-ir.mjs";

const A4H = JSON.parse(readFileSync(new URL("./fixtures/ir-pairs/a4h-ranges.json", import.meta.url), "utf8"));
const TYPES = {C: {abap: "C", len: 10}, N: {abap: "C", len: 4}, I: {abap: "I"}};
const ENGINES = [
  {dialect: "duckdb", make: () => new DuckDBDatabaseClient({path: ":memory:"})},
  {dialect: "sqlite", make: () => new FileSqliteClient({path: ":memory:"})},
];
// refused by name, and why: each one a form this module does not reconstruct
const KNOWN_REFUSALS = ["special padding form", "plus alone"];

for (const {dialect, make} of ENGINES) describe(`the A4H ranges measurement, replayed on ${dialect}`, function () {
  this.timeout(60000);
  let client;
  const tally = {same: 0, raised: 0, refused: 0};
  before(async () => {
    client = make();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "R" ("K" VARCHAR, "N" VARCHAR, "I" INTEGER, "C" VARCHAR)', expect: "none"});
    for (const row of A4H.rows) {
      await client.native({sql: 'INSERT INTO "R" VALUES (?, ?, ?, ?)', expect: "none", params: [
        {name: "k", value: row.k, type: "STRING"}, {name: "n", value: row.n, type: "STRING"},
        {name: "i", value: row.i, type: "I"}, {name: "c", value: row.c, type: "STRING"}]});
    }
  });
  after(async () => {
    await client.disconnect();
    // eslint-disable-next-line no-console
    console.log(`      ${dialect}: ${tally.same} same rows, ${tally.raised} raised as A4H did, ${tally.refused} refused by name`);
  });

  for (const one of A4H.cases) {
    it(one.name, async () => {
      const rows = one.rows.map((r) => ({SIGN: r.sign, OPTION: r.option, LOW: r.low, HIGH: r.high}));
      let pred;
      try {
        pred = rangesPredicate(one.column, TYPES[one.column], rows, {kind: one.column === "N" ? "NUMC" : undefined, lowLen: one.lowLen});
      } catch (error) {
        if (one.error !== undefined && (error instanceof RangesDump || error instanceof RangesDataError)) {
          expect(error.abap, "the same dump or exception as A4H").to.equal(one.error);
          tally.raised += 1;
          return;
        }
        expect(error, "a refusal of this module's own").to.be.instanceOf(RangesError);
        expect(error).to.not.be.instanceOf(RangesDump);
        expect(error).to.not.be.instanceOf(RangesDataError);
        expect(KNOWN_REFUSALS, error.message).to.include(error.reason);
        tally.refused += 1;
        return;
      }
      expect(one.error, "A4H raised here").to.equal(undefined);
      const {rows: got} = await client.native({...lower(project(filter(scan("R"), pred), [{as: "K", expr: col("K", {abap: "STRING"})}]), dialect), expect: "rows"});
      expect(got.map((r) => r.K).sort()).to.deep.equal([...one.matched].sort());
      tally.same += 1;
    });
  }
});
