// A dynamic Open SQL condition as IR (tools/ir-osql-where.mjs): the pairs
// file a port checks against is current, and the predicates select on DuckDB
// and SQLite what A4H selected on SFLIGHT (docs/osql-where.md), over a small
// table of the same shape.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {osqlWherePredicate, abapNumber, REASONS, OsqlWhereSyntax, OsqlWhereSemantics, OsqlWhereDump, OsqlWhereError} from "../tools/ir-osql-where.mjs";
import {COLUMNS, PAIRS_FILE, render} from "../tools/ir-osql-where-pairs.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";
import {filter, scan, project, order, col, T} from "../tools/sqlscript-ir.mjs";

describe("dynamic WHERE as IR: the pairs a port checks", () => {
  it("the pairs file is current (node tools/ir-osql-where-pairs.mjs writes it)", () => {
    expect(readFileSync(PAIRS_FILE, "utf8")).to.equal(render());
  });

  it("names the kernel's exception class where A4H raised one", () => {
    const raised = (where) => { try { osqlWherePredicate(where, COLUMNS); } catch (error) { return error; } };
    expect(raised("carrid = ")).to.be.instanceOf(OsqlWhereSyntax).and.include({abap: "CX_SY_DYNAMIC_OSQL_SYNTAX"});
    expect(raised("carrid != 'LH'")).to.be.instanceOf(OsqlWhereSyntax);
    expect(raised("nosuch = '1'")).to.be.instanceOf(OsqlWhereSemantics).and.include({abap: "CX_SY_DYNAMIC_OSQL_SEMANTICS"});
    expect(raised("1 = 1")).to.be.instanceOf(OsqlWhereSemantics);
    expect(raised("seatsmax = 'abc'")).to.be.instanceOf(OsqlWhereDump);
    expect(raised("carrid = lv_c")).to.be.instanceOf(OsqlWhereError).and.include({reason: "host variable"});
    expect(raised("carrid='LH'")).to.be.instanceOf(OsqlWhereSyntax);
    expect(raised("carrid IS INITIAL")).to.be.instanceOf(OsqlWhereSemantics);
    // not measured, so no kernel class is claimed for it
    expect(raised("carrid = 'LH")).to.be.instanceOf(OsqlWhereError).and.include({reason: "malformed"});
    expect(raised("( ".repeat(300) + "carrid = 'LH'" + " )".repeat(300))).to.include({reason: "too deep"});
    expect(raised(Array(2001).fill("carrid = 'LH'").join(" OR "))).to.include({reason: "too deep"});
  });

  it("converts a number as ABAP does: rounding half away from zero, a trailing sign, the empty text", () => {
    expect(abapNumber("384.5", 0)).to.equal("385");
    expect(abapNumber("385.4", 0)).to.equal("385");
    expect(abapNumber("-2.5", 0)).to.equal("-3");
    expect(abapNumber("385-", 0)).to.equal("-385");
    expect(abapNumber("+385", 0)).to.equal("385");
    expect(abapNumber("", 2)).to.equal("0.00");
    expect(abapNumber("422.935", 2)).to.equal("422.94");
    expect(abapNumber("9.995", 2)).to.equal("10.00");
    expect(abapNumber("0.004", 2)).to.equal("0.00");
    expect(abapNumber("-0.004", 2)).to.equal("0.00");
  });

  it("every refusal reason in the pairs is one of REASONS", () => {
    const file = JSON.parse(readFileSync(PAIRS_FILE, "utf8"));
    expect(file.reasons).to.deep.equal([...REASONS]);
    for (const one of file.pairs) {
      if (one.outcome?.reason !== undefined) expect(REASONS, one.name).to.include(one.outcome.reason);
    }
  });
});

// rows chosen so each measured rule decides a different set
const ROWS = [
  {CARRID: "LH", CONNID: "0400", SEATSMAX: 385, PRICE: 600, FLDATE: "20161115", NOTE: "a b "},
  {CARRID: "LH", CONNID: "0401", SEATSMAX: 280, PRICE: 400, FLDATE: "20161116", NOTE: "a b"},
  {CARRID: "AA", CONNID: "0017", SEATSMAX: 385, PRICE: 422.94, FLDATE: "20161115", NOTE: "it's"},
  {CARRID: "AA", CONNID: "0064", SEATSMAX: 250, PRICE: 300, FLDATE: "20170101", NOTE: null},
  {CARRID: "L_", CONNID: "0500", SEATSMAX: 100, PRICE: 100, FLDATE: "20170102", NOTE: null},
  {CARRID: "UA", CONNID: "0941", SEATSMAX: -385, PRICE: 900, FLDATE: "20170103", NOTE: null},
];

const ENGINES = [
  {dialect: "duckdb", make: () => new DuckDBDatabaseClient({path: ":memory:"})},
  {dialect: "sqlite", make: () => new FileSqliteClient({path: ":memory:"})},
];

for (const {dialect, make} of ENGINES) describe(`dynamic WHERE as IR, selecting on ${dialect}`, function () {
  this.timeout(30000);
  let client;
  before(async () => {
    client = make();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "FLIGHTS" ("CARRID" VARCHAR(3), "CONNID" VARCHAR(4), "SEATSMAX" INTEGER, "PRICE" DECIMAL(15,2), "FLDATE" VARCHAR(8), "NOTE" VARCHAR)', expect: "none"});
    for (const row of ROWS) {
      await client.native({sql: 'INSERT INTO "FLIGHTS" VALUES (?, ?, ?, ?, ?, ?)', expect: "none", params: [
        {name: "a", value: row.CARRID, type: "STRING"}, {name: "b", value: row.CONNID, type: "STRING"},
        {name: "c", value: row.SEATSMAX, type: "I"}, {name: "d", value: String(row.PRICE), type: "P(8,2)"},
        {name: "e", value: row.FLDATE, type: "STRING"}, {name: "f", value: row.NOTE, type: "STRING", isNull: row.NOTE === null}]});
    }
  });
  after(async () => { await client.disconnect(); });

  const selected = async (where) => {
    const pred = osqlWherePredicate(where, COLUMNS);
    const scanned = scan("FLIGHTS");
    const rel = project(pred === undefined ? scanned : filter(scanned, pred), [{as: "CONNID", expr: col("CONNID", T.char(4))}]);
    const {rows} = await client.native({...lower(order(rel, [{col: "CONNID", desc: false}]), dialect), expect: "rows"});
    return rows.map((one) => one.CONNID);
  };

  it("an empty condition is every row", async () => {
    expect(await selected("")).to.have.length(ROWS.length);
  });
  it("a literal is converted to the column: cut to CHAR3, NUMC zero-padded, a quoted number an INT4", async () => {
    expect(await selected("carrid = 'LH X'")).to.deep.equal(["0400", "0401"]);
    expect(await selected("connid = '400'")).to.deep.equal(["0400"]);
    expect(await selected("connid = 400")).to.deep.equal(["0400"]);
    expect(await selected("seatsmax = '385'")).to.deep.equal(["0017", "0400"]);
  });
  it("names are case-insensitive and literals are not, LIKE included", async () => {
    expect(await selected("CARRID = 'LH'")).to.deep.equal(["0400", "0401"]);
    expect(await selected("carrid = 'lh'")).to.deep.equal([]);
    expect(await selected("carrid LIKE 'l%'")).to.deep.equal([]);
    expect(await selected("carrid LIKE 'L%'")).to.deep.equal(["0400", "0401", "0500"]);
  });
  it("AND binds tighter than OR, and NOT takes the one condition after it", async () => {
    expect(await selected("carrid = 'LH' OR carrid = 'AA' AND seatsmax > 300")).to.deep.equal(["0017", "0400", "0401"]);
    expect(await selected("( carrid = 'LH' OR carrid = 'AA' ) AND seatsmax > 300")).to.deep.equal(["0017", "0400"]);
    expect(await selected("NOT carrid = 'LH' AND seatsmax > 300")).to.deep.equal(["0017"]);
  });
  it("ESCAPE makes the wildcard a character", async () => {
    expect(await selected("carrid LIKE 'L_'")).to.deep.equal(["0400", "0401", "0500"]);
    expect(await selected("carrid LIKE 'L#_' ESCAPE '#'")).to.deep.equal(["0500"]);
  });
  it("BETWEEN, IN and IS [NOT] NULL", async () => {
    expect(await selected("connid NOT BETWEEN '0' AND '400'")).to.deep.equal(["0401", "0500", "0941"]);
    expect(await selected("carrid IN ('AA','UA')")).to.deep.equal(["0017", "0064", "0941"]);
    expect(await selected("note IS NULL")).to.deep.equal(["0064", "0500", "0941"]);
    expect(await selected("note IS NOT NULL")).to.deep.equal(["0017", "0400", "0401"]);
    expect(await selected("price > '500.5'")).to.deep.equal(["0400", "0941"]);
  });
  it("NOT LIKE, a quote in a literal, and a STRING column's blanks", async () => {
    expect(await selected("carrid NOT LIKE 'L%'")).to.deep.equal(["0017", "0064", "0941"]);
    expect(await selected("note = 'it''s'")).to.deep.equal(["0017"]);
    // a quoted literal is C, and C into STRING drops its trailing blanks;
    // a backtick literal is a STRING and keeps them
    expect(await selected("note = 'a b '")).to.deep.equal(["0401"]);
    expect(await selected("note = `a b `")).to.deep.equal(["0400"]);
  });
  it("numbers as ABAP converts them: rounding, a trailing minus, packed decimals", async () => {
    expect(await selected("seatsmax = '384.5'")).to.deep.equal(["0017", "0400"]);
    expect(await selected("seatsmax = '385-'")).to.deep.equal(["0941"]);
    expect(await selected("seatsmax > -5")).to.have.length(5);
    expect(await selected("price = '422.935'")).to.deep.equal(["0017"]);
  });
  it("a date cut to eight characters", async () => {
    expect(await selected("fldate = '20161115000000'")).to.deep.equal(["0017", "0400"]);
    expect(await selected("fldate = '2016-11-15'")).to.deep.equal([]);
  });
  it("the producers' own shapes: a SADL key, the search help in lower case, SE16's negated pattern", async () => {
    expect(await selected("( CARRID = 'LH' ) AND ( CONNID = '0400' )")).to.deep.equal(["0400"]);
    expect(await selected("( carrid = 'LH' OR carrid = 'AA' ) AND ( connid = '0017' )")).to.deep.equal(["0017"]);
    expect(await selected("NOT ( carrid LIKE 'L%' )")).to.deep.equal(["0017", "0064", "0941"]);
  });
});
