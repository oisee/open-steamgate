// Writes as IR (tools/ir-writes.mjs), run on real engines: every case of the
// pairs file against a seeded table with a primary key, and the table after
// it compared with what ABAP means; the pairs file current.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";
import {insertRows, update, upsert, remove, bindValue, WriteError} from "../tools/ir-writes.mjs";
import {CASES, SEED, PAIRS_FILE, render} from "../tools/ir-writes-pairs.mjs";
import {T, lit} from "../tools/sqlscript-ir.mjs";

const ENGINES = [
  {dialect: "duckdb", make: () => new DuckDBDatabaseClient({path: ":memory:"})},
  {dialect: "sqlite", make: () => new FileSqliteClient({path: ":memory:"})},
];
const S = (m, i, t) => `${m}|${i}|${t}`;
const BASE = SEED.map(([m, i, t]) => S(m, i, t));
const without = (list, ...gone) => list.filter((one) => !gone.includes(one));
// the table after each case, as ABAP means it; undefined: the engine raises
const AFTER = {
  "INSERT one row, CHAR bound right-trimmed": [...BASE, S("001", 3, "three")],
  "INSERT two rows": [...BASE, S("001", 3, "three"), S("001", 4, "four")],
  "INSERT a duplicate key: the engine raises": undefined,
  "INSERT skipping duplicate keys": [...BASE, S("001", 5, "five")],
  "INSERT FROM a select": [...BASE, S("003", 1, "other")],
  "UPDATE one row by key": [...without(BASE, S("001", 1, "one")), S("001", 1, "uno")],
  "UPDATE every row of a client": [S("001", 1, "x"), S("001", 2, "x"), S("002", 1, "other")],
  "DELETE one row by key": without(BASE, S("001", 2, "two")),
  "MODIFY: one row updated, one inserted": [...without(BASE, S("001", 1, "one")), S("001", 1, "uno"), S("001", 7, "seven")],
  "MODIFY of key columns only": [...BASE, S("001", 8, "null")],
};

for (const {dialect, make} of ENGINES) describe(`writes as IR, on ${dialect}`, function () {
  this.timeout(30000);
  let client;
  beforeEach(async () => {
    client = make();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "T" ("MANDT" VARCHAR, "ID" INTEGER, "TXT" VARCHAR, PRIMARY KEY ("MANDT", "ID"))', expect: "none"});
    for (const [m, i, t] of SEED) {
      await client.native({sql: `INSERT INTO "T" VALUES ('${m}', ${i}, '${t}')`, expect: "none"});
    }
  });
  afterEach(async () => { await client.disconnect(); });
  const table = async () => (await client.native({sql: 'SELECT "MANDT", "ID", "TXT" FROM "T"', expect: "rows"})).rows
    .map((r) => S(r.MANDT, Number(r.ID), r.TXT ?? "null")).sort();

  for (const one of CASES) {
    it(`${one.name}: the table after it is what ABAP means`, async () => {
      const statement = lower(one.stmt(), dialect);
      if (AFTER[one.name] === undefined) {
        let caught;
        try { await client.native({...statement, expect: "none"}); } catch (error) { caught = error; }
        expect(caught, "a duplicate key is the engine's error").to.not.equal(undefined);
        expect(await table()).to.deep.equal([...BASE].sort());
        return;
      }
      await client.native({...statement, expect: "none"});
      expect(await table()).to.deep.equal([...AFTER[one.name]].sort());
    });
  }
});

describe("writes as IR: the pairs and the refusals", () => {
  it("the pairs file is current (node tools/ir-writes-pairs.mjs writes it), and every case has an expected table", () => {
    expect(readFileSync(PAIRS_FILE, "utf8")).to.equal(render());
    expect(Object.keys(AFTER).sort()).to.deep.equal(CASES.map((one) => one.name).sort());
  });

  it("renders the params in the order of the text, SET before WHERE", () => {
    const C = {abap: "C", len: 3};
    const out = lower(update("T", [{col: "TXT", expr: lit("new", C)}], {node: "bin", op: "=", left: {node: "col", name: "MANDT", type: C}, right: lit("001", C), type: T.bool}), "sqlite");
    expect(out.sql).to.equal('UPDATE "T" SET "TXT" = ? WHERE ("MANDT" = ?)');
    expect(out.params.map((p) => p.value)).to.deep.equal(["new", "001"]);
  });

  it("refuses what it cannot write, and a skipping INSERT on hana", () => {
    expect(() => insertRows("T", ["A"], [])).to.throw(WriteError, /no rows/);
    expect(() => insertRows("T", ["A", "B"], [[lit(1, T.int)]])).to.throw(WriteError, /one value per column/);
    expect(() => insertRows("T", ["A"], [[lit(1, T.int)]], {onDuplicate: "maybe"})).to.throw(WriteError, /error or ignore/);
    expect(() => update("T", [], undefined)).to.throw(WriteError, /sets nothing/);
    expect(() => upsert("T", ["A"], [[lit(1, T.int)]], [])).to.throw(WriteError, /key columns/);
    expect(() => upsert("T", ["A"], [[lit(1, T.int)]], ["B"])).to.throw(WriteError, /among its columns/);
    expect(() => bindValue("abcd", {abap: "C", len: 3})).to.throw(WriteError, /longer than the column/);
    expect(() => bindValue(1.5, T.int)).to.throw(WriteError, /not an INTEGER/);
    expect(() => lower(insertRows("T", ["A"], [[lit(1, T.int)]], {onDuplicate: "ignore"}), "hana")).to.throw(/not rendered for hana/);
    expect(lower(remove("T"), "sqlite").sql).to.equal('DELETE FROM "T"');
  });
});
