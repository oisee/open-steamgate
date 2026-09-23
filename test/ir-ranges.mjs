// ABAP ranges as IR (tools/ir-ranges.mjs): the meaning, run on real engines,
// the pairs file a port is checked against, and the hostPred marker.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {rangesPredicate, hostPred, likePattern, lowerPredicate, RangesError, RangesDump, RangesDataError} from "../tools/ir-ranges.mjs";
import {CASES, PAIRS_FILE, render} from "../tools/ir-ranges-pairs.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";
import {filter, scan, project, order, col, T} from "../tools/sqlscript-ir.mjs";

const ENGINES = [
  {dialect: "duckdb", make: () => new DuckDBDatabaseClient({path: ":memory:"})},
  {dialect: "sqlite", make: () => new FileSqliteClient({path: ":memory:"})},
];
// CHAR held right-trimmed, as a dictionary CHAR column is on HANA (measured)
const TEXT = ["A", "B", "C", "D", "M", "N", "T1", "T1*x", "Tab1*z", "T a1", "50%_off!", "50xyoff!", "X1", "Y1"];
const NUMS = [1, 2, 3, 4, 5, 6];
const NUMC = ["0004", "0005", "0007", "0010", "0011", "0070", "7"];
// the rows each case must select, as ABAP means it (checked against A4H by
// foreman-dell's measurement, .local/a4h-ranges-2026-09-23.json)
const EXPECTED = {
  "empty ranges: no restriction": TEXT,
  "I EQ": ["A"],
  "I EQ, CHAR with trailing blanks": ["A"],
  "I EQ with a HIGH, which EQ ignores": ["A"],
  "I EQ twice": ["A", "B"],
  "E EQ only": TEXT.filter((v) => v !== "A"),
  "I BT and E EQ": ["A", "B", "D", "M"],
  "I BT with LOW above HIGH": [],
  "I NB": TEXT.filter((v) => !(v >= "B" && v <= "D")),
  "I NE": [1, 2, 4, 5, 6],
  "I GT": [4, 5, 6],
  "I GE": [3, 4, 5, 6],
  "I LT": [1, 2],
  "I LE": [1, 2, 3],
  // T, anything, 1, a literal *, one character: "Tab1*z" too
  "I CP with * + and an escaped *": ["T1*x", "Tab1*z"],
  "I CP with a literal % and _": ["50%_off!"],
  "I CP with trailing blanks": ["T1", "T1*x", "Tab1*z", "T a1"],
  "I CP with a blank inside": ["T a1"],
  "I CP without a wildcard is an equality": ["B"],
  "I CP with an escaped * only is an equality": ["T1*x"],
  "I CP ending in a lone # escapes a padding blank": ["A"],
  "I CP of * alone is no restriction": TEXT,
  "I NP of * alone matches nothing": [],
  "I CP with a HIGH after LOW at full width": [],
  "E NP": ["X1"],
  "I EQ, NUMC zero-padded": ["0007"],
  "I BT, NUMC zero-padded to the column": ["0005", "0007", "0010"],
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
    for (const v of NUMC) await client.native({sql: 'INSERT INTO "Z" VALUES (?)', params: [{name: "p", value: v, type: "STRING"}], expect: "none"});
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

  it("translates a CP pattern: * any, + one, # escapes, and ESCAPE only when a literal % or _ needs it", () => {
    expect(likePattern("a#+b+c*")).to.deep.equal({text: "a+b_c%", escape: false});
    expect(likePattern("a%_#*")).to.deep.equal({text: "a#%#_*", escape: true});
    expect(likePattern("A#")).to.deep.equal({text: "A", escape: false});
  });

  it("renders what the kernel sends on A4H: an equality without a wildcard, 1 = 1 for *, LIKE, ESCAPE only when needed", () => {
    const C = {abap: "C", len: 10};
    const sql = (option, low, high) => lowerPredicate(rangesPredicate("COL", C, [{SIGN: "I", OPTION: option, LOW: low, HIGH: high}]), "sqlite").sql;
    expect(sql("CP", "DE")).to.equal('("COL" = ?)');
    expect(sql("CP", "D#*")).to.equal('("COL" = ?)');
    expect(sql("CP", "*")).to.equal("(1 = 1)");
    expect(sql("CP", "D*")).to.equal('("COL" LIKE ?)');
    expect(sql("CP", "5%*")).to.equal('("COL" LIKE ? ESCAPE ?)');
    expect(sql("NP", "X*")).to.equal('("COL" NOT LIKE ?)');
  });

  it("refuses what A4H dumps on, raises what A4H raises, and names the forms it does not reconstruct", () => {
    const C = {abap: "C", len: 3};
    // an uncatchable dump on A4H, never "no restriction"
    expect(() => rangesPredicate("C", C, [{SIGN: "i", OPTION: "EQ", LOW: "A"}])).to.throw(RangesDump, /SAPSQL_IN_ITAB_ILLEGAL_SIGN/);
    expect(() => rangesPredicate("C", C, [{SIGN: "I", OPTION: "eq", LOW: "A"}])).to.throw(RangesDump, /SAPSQL_IN_ITAB_ILLEGAL_OPTION/);
    expect(() => rangesPredicate("C", C, [{SIGN: "", OPTION: "", LOW: ""}])).to.throw(RangesDump, /ILLEGAL_SIGN/);
    // catchable exceptions on A4H
    expect(() => rangesPredicate("C", C, [{SIGN: "I", OPTION: "EQ", LOW: "ABCD"}])).to.throw(RangesDataError, /CX_SY_OPEN_SQL_DATA_ERROR/);
    expect(() => rangesPredicate("C", C, [{SIGN: "I", OPTION: "CP", LOW: "ABCDEFG*"}])).to.throw(RangesDataError, /CX_SY_DYNAMIC_OSQL_SEMANTICS/);
    // A4H renders a special form or binds a value the plan cache does not keep
    expect(() => rangesPredicate("C", C, [{SIGN: "I", OPTION: "CP", LOW: " *"}])).to.throw(RangesError, /blanks that meet the padding/);
    expect(() => rangesPredicate("C", C, [{SIGN: "I", OPTION: "CP", LOW: "X", HIGH: "*"}])).to.throw(RangesError, /blanks that meet the padding/);
    expect(() => rangesPredicate("C", C, [{SIGN: "I", OPTION: "CP", LOW: "+"}])).to.throw(RangesError, /matches the initial value/);
    expect(() => rangesPredicate("C", {abap: "I"}, [{SIGN: "I", OPTION: "CP", LOW: "1*"}])).to.throw(RangesError, /CP over a column of type I/);
    expect(() => rangesPredicate("C", C, [{SIGN: "I", OPTION: "EQ", LOW: "7a"}], {kind: "NUMC"})).to.throw(RangesError, /not NUMC digits/);
  });
});
