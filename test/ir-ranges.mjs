// ABAP ranges as IR (tools/ir-ranges.mjs): the meaning, run on real engines,
// the pairs file a port is checked against, and the hostPred marker.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {rangesPredicate, hostPred, likePattern, lowerPredicate, RangesError} from "../tools/ir-ranges.mjs";
import {CASES, PAIRS_FILE, render} from "../tools/ir-ranges-pairs.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";
import {filter, scan, project, order, col, T} from "../tools/sqlscript-ir.mjs";

const ENGINES = [
  {dialect: "duckdb", make: () => new DuckDBDatabaseClient({path: ":memory:"})},
  {dialect: "sqlite", make: () => new FileSqliteClient({path: ":memory:"})},
];
// CHAR held right-trimmed, as a dictionary CHAR column is on HANA (measured)
const TEXT = ["A", "B", "C", "D", "M", "N", "T1", "T1*x", "Tab1*z", "50%_off!", "50xyoff!", "X1", "Y1"];
const NUMS = [1, 2, 3, 4, 5, 6];
// the rows each case must select, as ABAP means it
const EXPECTED = {
  "empty ranges: no restriction": TEXT,
  "I EQ": ["A"],
  "I EQ, CHAR with trailing blanks": ["A"],
  "I EQ twice": ["A", "B"],
  "E EQ only": TEXT.filter((v) => v !== "A"),
  "I BT and E EQ": ["A", "B", "D", "M"],
  "I NB": TEXT.filter((v) => !(v >= "B" && v <= "D")),
  "I NE GT GE LT LE": NUMS,
  // T, anything, 1, a literal *, one character: "Tab1*z" too
  "I CP with * + and an escaped *": ["T1*x", "Tab1*z"],
  "I CP with a literal % and _": ["50%_off!"],
  "I CP with trailing blanks": ["T1", "T1*x", "Tab1*z"],
  "E NP": ["X1"],
  "I EQ, NUMC zero-padded": ["0007"],
};

for (const {dialect, make} of ENGINES) describe(`ABAP ranges as IR, on ${dialect}`, function () {
  this.timeout(30000);
  let client;
  before(async () => {
    client = make();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "T" ("COL" VARCHAR)', expect: "none"});
    for (const v of TEXT) await client.native({sql: 'INSERT INTO "T" VALUES (?)', params: [{name: "p", value: v, type: "STRING"}], expect: "none"});
    await client.native({sql: 'CREATE TABLE "N" ("COL" INTEGER)', expect: "none"});
    for (const v of NUMS) await client.native({sql: `INSERT INTO "N" VALUES (${v})`, expect: "none"});
    await client.native({sql: 'CREATE TABLE "Z" ("COL" VARCHAR)', expect: "none"});
    for (const v of ["0007", "0070", "7"]) await client.native({sql: 'INSERT INTO "Z" VALUES (?)', params: [{name: "p", value: v, type: "STRING"}], expect: "none"});
  });
  after(async () => { await client.disconnect(); });

  for (const one of CASES) {
    it(`${one.name} selects what ABAP means`, async () => {
      const table = one.type.abap === "I" ? "N" : one.kind === "NUMC" ? "Z" : "T";
      const {rows} = await client.native({...lower(filter(scan(table), rangesPredicate("COL", one.type, one.rows, {kind: one.kind})), dialect), expect: "rows"});
      expect(rows.map((r) => (typeof r.COL === "bigint" ? Number(r.COL) : r.COL)).sort()).to.deep.equal([...EXPECTED[one.name]].sort());
    });
  }
});

describe("ABAP ranges as IR: the pairs, the marker, the refusals", () => {
  it("the pairs file is current (node tools/ir-ranges-pairs.mjs writes it)", () => {
    expect(readFileSync(PAIRS_FILE, "utf8")).to.equal(render());
  });

  it("every case has an expected selection, and the pairs are rendered by lower() itself", () => {
    expect(Object.keys(EXPECTED).sort()).to.deep.equal(CASES.map((one) => one.name).sort());
    const {sql, params} = lowerPredicate(rangesPredicate("COL", {abap: "C", len: 10}, [{SIGN: "I", OPTION: "EQ", LOW: "A"}]), "sqlite");
    expect(sql).to.equal('("COL" = ?)');
    expect(params.map((p) => p.value)).to.deep.equal(["A"]);
  });

  it("a hostPred is a marker in the build-time text, listed with how many parameters precede it", () => {
    const C = {abap: "C", len: 10};
    const rel = order(project(filter(filter(scan("ZSTG_DEMO"), {node: "bin", op: "=", left: col("MANDT", {abap: "C", len: 3}), right: {node: "param", name: "MANDT", type: {abap: "C", len: 3}}, type: T.bool}), hostPred("r0", "STATUS", C)),
      [{as: "TRAVEL_ID", expr: col("TRAVEL_ID", C)}]), [{col: "TRAVEL_ID", desc: false}]);
    const out = lower(rel, "sqlite");
    expect(out.sql).to.contain("/*@range:r0*/");
    expect(out.hostPreds).to.deep.equal([{id: "r0", column: "STATUS", columnType: C, after: 1}]);
    expect(lower(scan("T"), "sqlite")).to.not.have.property("hostPreds");
    expect(() => lower(filter(scan("T"), hostPred("r 0", "S", C)), "sqlite")).to.throw(/not a plain name/);
  });

  it("translates a CP pattern: * any, + one, # escapes, % and _ literal", () => {
    expect(likePattern("a#+b+c*%_##")).to.equal("a+b_c%#%#_##");
    expect(() => likePattern("abc#")).to.throw(RangesError, /ends in the escape character/);
  });

  it("refuses what it cannot mean: an unknown OPTION or SIGN, CP over a number, a value too long or not NUMC digits", () => {
    const C = {abap: "C", len: 3};
    expect(() => rangesPredicate("C", C, [{SIGN: "I", OPTION: "ZZ", LOW: "A"}])).to.throw(RangesError, /OPTION "ZZ"/);
    expect(() => rangesPredicate("C", C, [{SIGN: "X", OPTION: "EQ", LOW: "A"}])).to.throw(RangesError, /SIGN "X"/);
    expect(() => rangesPredicate("C", {abap: "I"}, [{SIGN: "I", OPTION: "CP", LOW: "1*"}])).to.throw(RangesError, /CP over a column of type I/);
    expect(() => rangesPredicate("C", C, [{SIGN: "I", OPTION: "EQ", LOW: "ABCD"}])).to.throw(RangesError, /longer than the column's 3/);
    expect(() => rangesPredicate("C", C, [{SIGN: "I", OPTION: "EQ", LOW: "7a"}], {kind: "NUMC"})).to.throw(RangesError, /not NUMC digits/);
  });
});
