// Writes as IR (tools/ir-writes.mjs), run on real engines: every case of the
// pairs file against a seeded table with a primary key, and the table after
// it compared with what ABAP means; the pairs file current.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";
import {insertRows, insertFrom, update, upsert, remove, bindValue, WriteError} from "../tools/ir-writes.mjs";
import {CASES, SEED, PAIRS_FILE, render, P_CASES, P_SEED, W_CASES, W_SEED, W_EXACT} from "../tools/ir-writes-pairs.mjs";
import {T, lit, col, bin, project, scan} from "../tools/sqlscript-ir.mjs";

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
  "INSERT FROM TABLE with a duplicate: the others written, the host raises": [...BASE, S("001", 3, "b"), S("001", 4, "c")],
  "INSERT FROM TABLE with a duplicate inside the table: the first written": [...BASE, S("001", 5, "first")],
  "INSERT FROM a select, skipping duplicate keys": [...BASE, S("001", 3, "two"), S("002", 2, "other")],
  "MODIFY with a key twice: the last row wins": [...without(BASE, S("001", 1, "one")), S("001", 1, "b")],
  "MODIFY with a field left out writes its initial value": [...BASE, S("001", 8, "")],
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

// the packed table after each case, amounts at two decimals, timestamps whole
const PS = (m, i, a, t) => `${m}|${i}|${a}|${t}`;
const P_BASE = P_SEED.map(([m, i, a, t]) => PS(m, i, a, t));
const P_AFTER = {
  "INSERT a packed amount and a TIMESTAMP, as decimal strings of the type": [...P_BASE, PS("001", 3, "12.50", "20260924123456")],
  "INSERT a packed value given as a number": [...P_BASE, PS("001", 4, "3.00", "20260924000000")],
  "INSERT a negative amount": [...P_BASE, PS("001", 5, "-7.25", "0")],
  "MODIFY with the packed fields left out writes their initial values": [...P_BASE, PS("001", 6, "0.00", "0")],
  "UPDATE a packed amount by key": [PS("001", 1, "99.99", "20260924120000"), PS("001", 2, "0.50", "20260101000000")],
  "MODIFY a TIMESTAMP on an existing row": [PS("001", 1, "10.00", "20260924120000"), PS("001", 2, "0.50", "20261231235959")],
  "UPDATE an amount by arithmetic on a packed parameter": [PS("001", 1, "20.00", "20260924120000"), PS("001", 2, "0.50", "20260101000000")],
  "UPDATE where arithmetic on a packed column meets a packed parameter": [PS("001", 1, "10.00", "1"), PS("001", 2, "0.50", "20260101000000")],
  "INSERT the product of a packed parameter and an integer": [...P_BASE, PS("001", 7, "25.00", "0")],
};

for (const {dialect, make} of ENGINES) describe(`packed writes as IR, on ${dialect}`, function () {
  this.timeout(30000);
  let client;
  beforeEach(async () => {
    client = make();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "P" ("MANDT" VARCHAR, "ID" INTEGER, "AMOUNT" DECIMAL(15,2), "TS" DECIMAL(15,0), PRIMARY KEY ("MANDT", "ID"))', expect: "none"});
    for (const [m, i, a, t] of P_SEED) {
      await client.native({sql: `INSERT INTO "P" VALUES ('${m}', ${i}, ${a}, ${t})`, expect: "none"});
    }
  });
  afterEach(async () => { await client.disconnect(); });
  // read back as the engine's own text where it has a decimal type, so a
  // rounding on the way in shows; SQLite keeps a REAL and is normalised
  const table = async () => dialect === "sqlite"
    ? (await client.native({sql: 'SELECT "MANDT", "ID", "AMOUNT", "TS" FROM "P"', expect: "rows"})).rows
      .map((r) => PS(r.MANDT, Number(r.ID), Number(r.AMOUNT).toFixed(2), String(BigInt(Math.round(Number(r.TS)))))).sort()
    : (await client.native({sql: 'SELECT "MANDT", "ID", CAST("AMOUNT" AS VARCHAR) AS "A", CAST("TS" AS VARCHAR) AS "T" FROM "P"', expect: "rows"})).rows
      .map((r) => PS(r.MANDT, Number(r.ID), r.A, r.T)).sort();

  for (const one of P_CASES) {
    it(`${one.name}: the table after it is what ABAP means`, async () => {
      await client.native({...lower(one.stmt(), dialect), expect: "none"});
      expect(await table()).to.deep.equal([...P_AFTER[one.name]].sort());
    });
  }
});

// P 31,14: 31 digits exact where the engine has a decimal type
const W_AFTER = {
  "INSERT a P 31,14 value with all 31 digits": [["001", 1, "0.00000000000001"], ["001", 2, "12345678901234567.12345678901234"]],
  "UPDATE a P 31,14 value to its negative extreme": [["001", 1, "-99999999999999999.99999999999999"]],
};
for (const {dialect, make} of ENGINES) describe(`a P 31,14 column written as IR, on ${dialect}`, function () {
  this.timeout(30000);
  let client;
  beforeEach(async () => {
    client = make();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "W" ("MANDT" VARCHAR, "ID" INTEGER, "BIG" DECIMAL(31,14), PRIMARY KEY ("MANDT", "ID"))', expect: "none"});
    for (const [m, i, b] of W_SEED) await client.native({sql: `INSERT INTO "W" VALUES ('${m}', ${i}, ${b})`, expect: "none"});
  });
  afterEach(async () => { await client.disconnect(); });
  for (const one of W_CASES) {
    it(`${one.name}: ${W_EXACT.includes(dialect) ? "every digit read back" : "the nearest REAL, SQLite having no decimal type"}`, async () => {
      await client.native({...lower(one.stmt(), dialect), expect: "none"});
      if (W_EXACT.includes(dialect)) {
        const rows = (await client.native({sql: 'SELECT "MANDT", "ID", CAST("BIG" AS VARCHAR) AS "B" FROM "W" ORDER BY "ID"', expect: "rows"})).rows;
        expect(rows.map((r) => [r.MANDT, Number(r.ID), r.B])).to.deep.equal(W_AFTER[one.name]);
      } else {
        // read as REAL: NUMERIC affinity stores a whole-valued REAL as an
        // INTEGER, and 1.2e16 read as one is past what the client returns
        const rows = (await client.native({sql: 'SELECT "MANDT", "ID", CAST("BIG" AS REAL) AS "BIG" FROM "W" ORDER BY "ID"', expect: "rows"})).rows;
        expect(rows.map((r) => [r.MANDT, Number(r.ID), Number(r.BIG)])).to.deep.equal(W_AFTER[one.name].map(([m, i, b]) => [m, i, Number(b)]));
      }
    });
  }
});

describe("writes as IR: the pairs and the refusals", () => {
  it("binds a packed value as the decimal string of its type, and refuses one a work area could not hold", () => {
    const P = {abap: "P", len: 15, dec: 2};
    expect(bindValue("12.5", P)).to.include({value: "12.50"});
    expect(bindValue(3, P)).to.include({value: "3.00"});
    expect(bindValue("1.500", P)).to.include({value: "1.50"});
    expect(bindValue("-0.00", P)).to.include({value: "0.00"});
    expect(bindValue(undefined, P)).to.include({value: "0.00"});
    expect(bindValue(undefined, {abap: "P", len: 15, dec: 0})).to.include({value: "0"});
    expect(() => bindValue("1.555", P)).to.throw(WriteError, /more than the column's 2 decimals/);
    expect(() => bindValue("12345678901234", P)).to.throw(WriteError, /does not fit the column's 15 digits/);
    expect(() => bindValue(1e21, P)).to.throw(WriteError, /past 2\^53/);
    expect(() => bindValue("abc", P)).to.throw(WriteError, /not a decimal number/);
    // the edges of the type and of the grammar (abapNumber's, without its rounding)
    expect(bindValue("9999999999999.99", P)).to.include({value: "9999999999999.99"});
    expect(() => bindValue("10000000000000.00", P)).to.throw(WriteError, /does not fit the column's 15 digits/);
    expect(bindValue("0005.10", P)).to.include({value: "5.10"});
    expect(bindValue("  5  ", P)).to.include({value: "5.00"});
    expect(bindValue("5-", P)).to.include({value: "-5.00"});
    expect(bindValue("+5", P)).to.include({value: "5.00"});
    expect(() => bindValue("-5-", P)).to.throw(WriteError, /not a decimal number/);
    expect(() => bindValue("\t5", P)).to.throw(WriteError, /not a decimal number/);
    expect(() => bindValue(".5", P)).to.throw(WriteError, /not a decimal number/);
    expect(() => bindValue("1e3", P)).to.throw(WriteError, /not a decimal number/);
    expect(() => bindValue(1.555, P)).to.throw(WriteError, /more than the column's 2 decimals/);
    expect(bindValue(-0, P)).to.include({value: "0.00"});
    expect(bindValue(2 ** 53 - 1, {abap: "P", len: 31, dec: 0})).to.include({value: "9007199254740991"});
    expect(() => bindValue(2 ** 53 + 2, {abap: "P", len: 31, dec: 0})).to.throw(WriteError, /past 2\^53/);
    expect(bindValue("12345678901234567890", {abap: "P", len: 31, dec: 0})).to.include({value: "12345678901234567890"});
    expect(bindValue(12n, {abap: "P", len: 31, dec: 0})).to.include({value: "12"});
    // the type as DDIC has it: len 1..31 (31 when absent), dec 0..14
    expect(bindValue("1", {abap: "P", dec: 2})).to.include({value: "1.00"});
    expect(() => bindValue("1", {abap: "P", len: 32, dec: 0})).to.throw(WriteError, /1 to 31 digits/);
    expect(() => bindValue("1", {abap: "P", len: 31, dec: 15})).to.throw(WriteError, /0 to 14/);
    expect(() => bindValue("1", {abap: "P", len: 3, dec: 4})).to.throw(WriteError, /not more than its 3 digits/);
    expect(() => bindValue("1", {abap: "P", len: 1.5})).to.throw(WriteError, /1 to 31 digits/);
  });

  it("refuses a packed literal that is not the decimal string of its type, where values are written", () => {
    const S = {MANDT: {abap: "C", len: 3}, AMT: {abap: "P", len: 15, dec: 2}};
    const eqM = {node: "bin", op: "=", left: {node: "col", name: "MANDT", type: S.MANDT}, right: lit("001", S.MANDT), type: T.bool};
    expect(() => insertRows("X", ["MANDT", "AMT"], [[lit("001", S.MANDT), lit(1.5, S.AMT)]])).to.throw(WriteError, /packed literal 1.5/);
    expect(() => insertRows("X", ["MANDT", "AMT"], [[lit("001", S.MANDT), lit("1.5", S.AMT)]])).to.throw(WriteError, /packed literal "1.5"/);
    expect(() => update("X", [{col: "AMT", expr: lit(2, S.AMT)}], eqM)).to.throw(WriteError, /packed literal 2/);
    expect(() => upsert("X", ["MANDT", "AMT"], [[lit("001", S.MANDT), lit("1.500", S.AMT)]], ["MANDT"])).to.throw(WriteError, /packed literal/);
    expect(() => update("X", [{col: "AMT", expr: bin("+", col("AMT", S.AMT), lit(1, S.AMT), S.AMT)}], eqM)).to.throw(WriteError, /packed literal 1/);
    expect(insertRows("X", ["MANDT", "AMT"], [[lit("001", S.MANDT), lit("1.50", S.AMT)]]).rows[0][1].value).to.equal("1.50");
    expect(() => insertFrom("X", ["MANDT", "AMT"], project(scan("Y"), [{as: "MANDT", expr: col("MANDT", S.MANDT)}, {as: "AMT", expr: lit(0.1 + 0.2, S.AMT)}])))
      .to.throw(WriteError, /packed literal 0.30000000000000004/);
  });

  it("every packed case has an expected table", () => {
    expect(Object.keys(P_AFTER).sort()).to.deep.equal(P_CASES.map((one) => one.name).sort());
  });

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

  it("an INSERT FROM TABLE carries how many rows it was given, for the host to raise when fewer were written", () => {
    const stmt = CASES.find((one) => one.name.startsWith("INSERT FROM TABLE with a duplicate:")).stmt();
    expect(stmt).to.include({onDuplicate: "raise", expected: 3});
    expect(lower(stmt, "sqlite").sql).to.match(/ON CONFLICT DO NOTHING$/);
  });

  it("refuses what it cannot write, and a skipping INSERT on hana", () => {
    expect(() => insertRows("T", ["A"], [])).to.throw(WriteError, /no rows/);
    expect(() => insertRows("T", ["A", "B"], [[lit(1, T.int)]])).to.throw(WriteError, /one value per column/);
    expect(() => insertRows("T", ["A"], [[lit(1, T.int)]], {onDuplicate: "maybe"})).to.throw(WriteError, /error, raise or ignore/);
    expect(() => insertFrom("T", ["A"], {rel: "scan", table: "S"}, {onDuplicate: "ignor"})).to.throw(WriteError, /error, raise or ignore/);
    expect(() => upsert("T", ["A", "B"], [[lit(1, T.int)]], ["A"])).to.throw(WriteError, /one value per column/);
    expect(() => bindValue(null, T.int)).to.throw(WriteError, /NULL value/);
    expect(bindValue(undefined, {abap: "C", len: 3})).to.include({value: ""});
    expect(bindValue("a  ", T.str)).to.include({value: "a  "});
    expect(() => update("T", [], undefined)).to.throw(WriteError, /sets nothing/);
    expect(() => upsert("T", ["A"], [[lit(1, T.int)]], [])).to.throw(WriteError, /key columns/);
    expect(() => upsert("T", ["A"], [[lit(1, T.int)]], ["B"])).to.throw(WriteError, /among its columns/);
    expect(() => bindValue("abcd", {abap: "C", len: 3})).to.throw(WriteError, /longer than the column/);
    expect(() => bindValue(1.5, T.int)).to.throw(WriteError, /not an INTEGER/);
    expect(() => lower(insertRows("T", ["A"], [[lit(1, T.int)]], {onDuplicate: "ignore"}), "hana")).to.throw(/not rendered for hana/);
    expect(lower(remove("T"), "sqlite").sql).to.equal('DELETE FROM "T"');
  });
});
